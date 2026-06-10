/**
 * ALPHA RADAR — servidor do dashboard de copy-trading
 *
 * Proxy + agregador das APIs públicas do Polymarket e Kalshi.
 * Zero dependências: roda com Node 18+ (fetch nativo).
 *
 *   node server.js          → http://localhost:3000
 *   PORT=8080 node server.js
 *
 * Se as APIs externas estiverem inacessíveis (sem internet / firewall),
 * o servidor responde com dados de demonstração e marca `demo: true`
 * para o frontend exibir o aviso.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

const PM_LEADERBOARD = 'https://lb-api.polymarket.com/leaderboard';
const PM_DATA = 'https://data-api.polymarket.com';
const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';

const FETCH_TIMEOUT_MS = 12_000;
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // histórico de PnL a cada 10 min

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value, null, 2));
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'alpha-radar/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// cache simples em memória: evita martelar as APIs a cada refresh do front
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------------------
// dados de demonstração (usados quando as APIs externas estão inacessíveis)
// ---------------------------------------------------------------------------

const DEMO = require('./demo-data.js');

// ---------------------------------------------------------------------------
// Polymarket
// ---------------------------------------------------------------------------

// A API de leaderboard já mudou de formato/parâmetros mais de uma vez;
// tentamos várias combinações de endpoint + janela até uma responder.
const WINDOW_ALIASES = {
  '1d': ['1d', 'day'],
  '1w': ['1w', '7d', 'week'],
  '1m': ['1m', '30d', 'month'],
  all: ['all'],
};

function normalizeLeaderboardRow(r, i) {
  return {
    rank: i + 1,
    address: r.proxyWallet || r.walletAddress || r.address || r.wallet || r.user || null,
    name: r.userName || r.name || r.pseudonym || null,
    pseudonym: r.pseudonym || null,
    avatar: r.profileImage || r.profileImageOptimized || null,
    amount: Number(r.amount ?? r.pnl ?? r.vol ?? r.volume ?? r.profit ?? 0),
  };
}

/** Leaderboard das carteiras com maior PnL/volume na janela escolhida. */
async function getLeaderboard(window = '1m', rankType = 'pnl', limit = 20) {
  return cached(`lb:${window}:${rankType}:${limit}`, 60_000, async () => {
    const windows = WINDOW_ALIASES[window] || [window];
    const candidates = [];
    for (const w of windows) {
      candidates.push(`${PM_LEADERBOARD}?window=${w}&rankType=${rankType}&limit=${limit}`);
      candidates.push(`${PM_DATA}/leaderboard?window=${w}&rankType=${rankType}&limit=${limit}`);
    }

    let lastErr = null;
    for (const url of candidates) {
      try {
        const rows = await fetchJson(url);
        const arr = Array.isArray(rows) ? rows : rows?.leaderboard || rows?.traders || [];
        const list = arr.map(normalizeLeaderboardRow).filter((t) => t.address);
        if (list.length) return { demo: false, window, rankType, traders: list };
      } catch (err) {
        lastErr = err;
      }
    }
    console.warn(`[leaderboard] usando demo: ${lastErr ? lastErr.message : 'resposta vazia'}`);
    return { demo: true, window, rankType, traders: DEMO.leaderboard };
  });
}

/**
 * Estatísticas calculadas a partir das posições + histórico de trades.
 *
 * Honestidade metodológica: a API só retorna as posições ATUAIS da
 * carteira, então o win rate considera posições com resultado relevante
 * (PnL realizado ou flutuante) — é um proxy da forma do trader, não o
 * histórico completo de mercados já encerrados e resgatados.
 */
function computeStats(positions, activity) {
  const decided = positions.filter((p) => Math.abs(p.cashPnl) > 0.01 || Math.abs(p.realizedPnl) > 0.01);
  const wins = decided.filter((p) => p.cashPnl + p.realizedPnl > 0).length;
  const trades = activity.filter((a) => a.type === 'TRADE');
  const buys = trades.filter((t) => t.side === 'BUY');
  const volume = trades.reduce((s, t) => s + t.usdcSize, 0);
  const unrealized = positions.reduce((s, p) => s + p.cashPnl, 0);
  const realized = positions.reduce((s, p) => s + p.realizedPnl, 0);
  const invested = positions.reduce((s, p) => s + p.initialValue, 0);
  const roiAvg = decided.length
    ? decided.reduce((s, p) => s + (p.percentPnl || 0), 0) / decided.length
    : 0;

  const dayMs = 86_400_000;
  const now = Date.now();
  const last7d = trades.filter((t) => now - t.timestamp * 1000 < 7 * dayMs);

  return {
    pnlTotal: unrealized + realized,
    pnlUnrealized: unrealized,
    pnlRealized: realized,
    invested,
    winRate: decided.length ? (wins / decided.length) * 100 : null,
    decidedPositions: decided.length,
    openPositions: positions.length,
    roiAvg,
    tradeCount: trades.length,
    buyRatio: trades.length ? (buys.length / trades.length) * 100 : null,
    avgTradeSize: trades.length ? volume / trades.length : 0,
    volumeRecent: volume,
    tradesPerDay7d: last7d.length / 7,
    lastTradeAt: trades.length ? Math.max(...trades.map((t) => t.timestamp)) : null,
  };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Tolerante a variações de nome/ausência de campos na API real: valores
// derivados (initialValue, cashPnl, percentPnl) são recalculados a partir
// de size/avgPrice/curPrice sempre que possível, em vez de confiar no campo.
function normalizePosition(p) {
  const size = num(p.size);
  const avgPrice = num(p.avgPrice ?? p.avg_price);
  const curPrice = num(p.curPrice ?? p.currentPrice ?? p.price);
  const initialValue = num(p.initialValue) || size * avgPrice;
  const currentValue = num(p.currentValue) || size * curPrice;
  const cashPnl = p.cashPnl != null ? num(p.cashPnl) : currentValue - initialValue;
  const realizedPnl = num(p.realizedPnl ?? p.realizedPnL);
  return {
    title: p.title || p.question || p.market || '—',
    outcome: p.outcome || null,
    slug: p.eventSlug || p.slug || null,
    icon: p.icon || null,
    size,
    avgPrice,
    curPrice,
    initialValue,
    currentValue,
    cashPnl,
    realizedPnl,
    // % calculado localmente: o campo da API ora vem como fração, ora como %
    percentPnl: initialValue > 0.005 ? (cashPnl / initialValue) * 100 : num(p.percentPnl),
    endDate: p.endDate || null,
    redeemable: !!p.redeemable,
  };
}

function normalizeActivity(a) {
  let ts = num(a.timestamp);
  if (ts > 1e12) ts = Math.round(ts / 1000); // ms → s
  const size = num(a.size);
  const price = num(a.price);
  return {
    timestamp: ts,
    type: String(a.type || 'TRADE').toUpperCase(),
    side: a.side ? String(a.side).toUpperCase() : null,
    size,
    usdcSize: num(a.usdcSize ?? a.usdc) || size * price,
    price,
    title: a.title || a.question || '—',
    outcome: a.outcome || null,
    slug: a.eventSlug || a.slug || null,
    txHash: a.transactionHash || null,
  };
}

/** Perfil completo de uma carteira: posições, trades recentes e estatísticas. */
async function getWallet(address) {
  return cached(`wallet:${address}`, 45_000, async () => {
    try {
      const [posRaw, actRaw] = await Promise.all([
        fetchJson(
          `${PM_DATA}/positions?user=${address}&sortBy=CURRENT&sortDirection=DESC&sizeThreshold=0.1&limit=100`
        ),
        fetchJson(`${PM_DATA}/activity?user=${address}&limit=100`),
      ]);
      const positions = (posRaw || []).map(normalizePosition);
      const activity = (actRaw || []).map(normalizeActivity);
      return {
        demo: false,
        address,
        positions,
        activity,
        stats: computeStats(positions, activity),
      };
    } catch (err) {
      console.warn(`[wallet ${address.slice(0, 10)}…] usando demo: ${err.message}`);
      const d = DEMO.wallet(address);
      return { demo: true, address, ...d, stats: computeStats(d.positions, d.activity) };
    }
  });
}

/**
 * Feed de novas posições: junta a atividade recente de todas as carteiras
 * monitoradas (watchlist + top N do leaderboard) em ordem cronológica.
 */
async function getFeed() {
  const watchlist = loadJson('watchlist.json', []);
  const lb = await getLeaderboard('1m', 'pnl', 10);
  const auto = lb.traders.slice(0, 8).map((t) => ({
    address: t.address,
    name: t.name || t.pseudonym || null,
    source: 'leaderboard',
  }));
  const manual = watchlist.map((w) => ({ ...w, source: 'watchlist' }));

  const seen = new Set();
  const tracked = [...manual, ...auto].filter((t) => {
    if (!t.address || seen.has(t.address)) return false;
    seen.add(t.address);
    return true;
  });

  const wallets = await Promise.all(tracked.map((t) => getWallet(t.address)));
  const demo = wallets.some((w) => w.demo);

  const lastSeen = loadJson('last-seen.json', {});
  const items = [];
  for (let i = 0; i < tracked.length; i++) {
    const t = tracked[i];
    const w = wallets[i];
    const cutoff = lastSeen[t.address] || 0;
    for (const a of w.activity.filter((x) => x.type === 'TRADE').slice(0, 25)) {
      items.push({
        ...a,
        trader: t.name || `${t.address.slice(0, 6)}…${t.address.slice(-4)}`,
        address: t.address,
        source: t.source,
        isNew: a.timestamp > cutoff,
      });
    }
    if (w.activity.length) {
      lastSeen[t.address] = Math.max(cutoff, ...w.activity.map((a) => a.timestamp));
    }
  }
  saveJson('last-seen.json', lastSeen);

  items.sort((a, b) => b.timestamp - a.timestamp);
  return { demo, tracked: tracked.length, items: items.slice(0, 60) };
}

// ---------------------------------------------------------------------------
// histórico de performance (snapshots de PnL das carteiras monitoradas)
// ---------------------------------------------------------------------------

async function snapshotPerformance() {
  try {
    const lb = await getLeaderboard('1m', 'pnl', 10);
    const watchlist = loadJson('watchlist.json', []);
    const addrs = new Set([
      ...lb.traders.slice(0, 8).map((t) => t.address),
      ...watchlist.map((w) => w.address),
    ]);
    const history = loadJson('history.json', {});
    const t = Date.now();
    for (const addr of addrs) {
      if (!addr) continue;
      const w = await getWallet(addr);
      const arr = history[addr] || [];
      arr.push({ t, pnl: Math.round(w.stats.pnlTotal * 100) / 100, winRate: w.stats.winRate });
      history[addr] = arr.slice(-500); // mantém ~3,5 dias em intervalos de 10 min
    }
    saveJson('history.json', history);
  } catch (err) {
    console.warn(`[snapshot] falhou: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Kalshi — radar de mercados (a API pública não expõe dados por trader)
// ---------------------------------------------------------------------------

async function getKalshiRadar() {
  return cached('kalshi', 120_000, async () => {
    try {
      const data = await fetchJson(`${KALSHI_API}/markets?limit=200&status=open`);
      const markets = (data.markets || [])
        .map((m) => {
          const last = num(m.last_price) || num(m.yes_bid);
          return {
            ticker: m.ticker,
            title: m.title || m.ticker,
            subtitle: m.subtitle || m.yes_sub_title || '',
            lastPrice: last,
            prevPrice: num(m.previous_price) || last,
            volume24h: num(m.volume_24h),
            openInterest: num(m.open_interest),
            closeTime: m.close_time || null,
          };
        })
        .filter((m) => m.volume24h > 0)
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, 15);
      return { demo: false, markets };
    } catch (err) {
      console.warn(`[kalshi] usando demo: ${err.message}`);
      return { demo: true, markets: DEMO.kalshi };
    }
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // -------- API --------
    if (p === '/api/leaderboard') {
      const window = url.searchParams.get('window') || '1m';
      const rankType = url.searchParams.get('rankType') || 'pnl';
      return sendJson(res, 200, await getLeaderboard(window, rankType, 20));
    }

    if (p.startsWith('/api/wallet/')) {
      const address = p.slice('/api/wallet/'.length);
      if (!/^0x[a-fA-F0-9]{40}$/.test(address) && !address.startsWith('0xdemo')) {
        return sendJson(res, 400, { error: 'endereço inválido' });
      }
      return sendJson(res, 200, await getWallet(address));
    }

    if (p === '/api/feed') return sendJson(res, 200, await getFeed());

    if (p === '/api/kalshi') return sendJson(res, 200, await getKalshiRadar());

    if (p === '/api/history') {
      const history = loadJson('history.json', {});
      const address = url.searchParams.get('address');
      return sendJson(res, 200, address ? history[address] || [] : history);
    }

    if (p === '/api/watchlist') {
      const watchlist = loadJson('watchlist.json', []);
      if (req.method === 'GET') return sendJson(res, 200, watchlist);
      if (req.method === 'POST') {
        const { address, name } = await readBody(req);
        if (!address) return sendJson(res, 400, { error: 'address obrigatório' });
        if (!watchlist.some((w) => w.address === address)) {
          watchlist.push({ address, name: name || null, addedAt: Date.now() });
          saveJson('watchlist.json', watchlist);
        }
        return sendJson(res, 200, watchlist);
      }
      if (req.method === 'DELETE') {
        const { address } = await readBody(req);
        const next = watchlist.filter((w) => w.address !== address);
        saveJson('watchlist.json', next);
        return sendJson(res, 200, next);
      }
    }

    // -------- estáticos --------
    let file = p === '/' ? '/index.html' : p;
    const full = path.join(PUBLIC_DIR, path.normalize(file));
    if (!full.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
      return fs.createReadStream(full).pipe(res);
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`⚡ ALPHA RADAR rodando em http://localhost:${PORT}`);
  snapshotPerformance();
  setInterval(snapshotPerformance, SNAPSHOT_INTERVAL_MS);
});
