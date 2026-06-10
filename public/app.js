/* ALPHA RADAR — lógica do frontend */

const $ = (sel) => document.querySelector(sel);
const FEED_INTERVAL_MS = 60_000;

let currentWallet = null;

// ───────────────────────── formatação ─────────────────────────

const fmtUsd = (v, opts = {}) =>
  (v < 0 ? '-' : '') +
  '$' +
  Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0, ...opts });

const fmtUsdCompact = (v) => {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${a.toFixed(0)}`;
};

const fmtCents = (p) => `${Math.round((p <= 1 ? p * 100 : p))}¢`;

const fmtPct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);

function timeAgo(tsSec) {
  const s = Math.max(0, Date.now() / 1000 - tsSec);
  if (s < 60) return `${Math.floor(s)}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
}

const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

const pnlClass = (v) => (v >= 0 ? 'pos' : 'neg');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function setDemoBadge(isDemo) {
  $('#demo-badge').classList.toggle('hidden', !isDemo);
  $('#live-badge').classList.toggle('hidden', !!isDemo);
}

// ───────────────────────── relógio ─────────────────────────

setInterval(() => {
  $('#clock').textContent = new Date().toLocaleTimeString('pt-BR');
}, 1000);

// ───────────────────────── leaderboard ─────────────────────────

async function loadLeaderboard() {
  const window = $('#lb-window').value;
  const rankType = $('#lb-rank').value;
  $('#lb-amount-col').textContent = rankType === 'pnl' ? 'PnL' : 'Volume';

  const data = await api(`/api/leaderboard?window=${window}&rankType=${rankType}`);
  setDemoBadge(data.demo);

  const tbody = $('#lb-table tbody');
  tbody.innerHTML = data.traders
    .map((t) => {
      const name = t.name || t.pseudonym || shortAddr(t.address);
      const avatar = t.avatar
        ? `<img class="avatar" src="${esc(t.avatar)}" alt="" />`
        : `<span class="avatar">${esc(name.slice(0, 2).toUpperCase())}</span>`;
      return `<tr class="clickable" data-addr="${esc(t.address)}" data-name="${esc(name)}">
        <td class="rank ${t.rank <= 3 ? 'top' : ''}">${t.rank}</td>
        <td><div class="trader-cell">${avatar}
          <div><div class="trader-name">${esc(name)}</div>
          <div class="trader-addr mono">${shortAddr(t.address)}</div></div></div></td>
        <td class="num mono ${rankType === 'pnl' ? pnlClass(t.amount) : ''}">${fmtUsdCompact(t.amount)}</td>
        <td class="num">→</td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('tr').forEach((tr) =>
    tr.addEventListener('click', () => openWallet(tr.dataset.addr, tr.dataset.name))
  );
}

$('#lb-window').addEventListener('change', loadLeaderboard);
$('#lb-rank').addEventListener('change', loadLeaderboard);

// ───────────────────────── feed de novas posições ─────────────────────────

async function loadFeed() {
  const data = await api('/api/feed');
  $('#feed-meta').textContent = `monitorando ${data.tracked} carteiras`;

  const srcTag = (s) =>
    s === 'watchlist' ? '<span class="tag tag-watch">★ watchlist</span>' : '<span class="tag tag-lb">top pnl</span>';

  $('#feed').innerHTML =
    data.items
      .map(
        (it) => `<div class="feed-item ${it.isNew ? 'new' : ''}">
        <div class="feed-top">
          ${it.isNew ? '<span class="tag tag-new">NOVO</span>' : ''}
          <span class="feed-trader" data-addr="${esc(it.address)}" data-name="${esc(it.trader)}">${esc(it.trader)}</span>
          ${srcTag(it.source)}
          <span class="feed-time">${timeAgo(it.timestamp)}</span>
        </div>
        <div class="feed-market">
          <span class="${it.side === 'BUY' ? 'side-buy' : 'side-sell'}">${it.side === 'BUY' ? '▲ COMPROU' : '▼ VENDEU'}</span>
          ${esc(it.outcome || '')} — ${esc(it.title)}
        </div>
        <div class="feed-detail">${fmtCents(it.price)} · ${fmtUsdCompact(it.usdcSize)} · ${Math.round(it.size).toLocaleString('pt-BR')} shares</div>
      </div>`
      )
      .join('') || '<div class="empty">Sem atividade recente nas carteiras monitoradas.</div>';

  $('#feed').querySelectorAll('.feed-trader').forEach((el) =>
    el.addEventListener('click', () => openWallet(el.dataset.addr, el.dataset.name))
  );
}

$('#feed-refresh').addEventListener('click', loadFeed);

// ───────────────────────── detalhe da carteira ─────────────────────────

function statCard(k, v, d = '', cls = '') {
  return `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="d">${d}</div></div>`;
}

async function openWallet(address, name) {
  currentWallet = { address, name };
  $('#wallet-title').textContent = `${name || shortAddr(address)} · ${shortAddr(address)}`;
  $('#wallet-empty').classList.add('hidden');
  $('#wallet-body').classList.remove('hidden');
  $('#watch-btn').classList.remove('hidden');
  $('#panel-wallet').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const w = await api(`/api/wallet/${address}`);
  const s = w.stats;

  $('#stat-grid').innerHTML = [
    statCard('PnL total', fmtUsdCompact(s.pnlTotal), `${fmtUsdCompact(s.pnlRealized)} realizado`, pnlClass(s.pnlTotal)),
    statCard('Win rate', fmtPct(s.winRate), `${s.decidedPositions} posições decididas`, s.winRate >= 50 ? 'pos' : 'neg'),
    statCard('ROI médio', fmtPct(s.roiAvg), 'por posição', pnlClass(s.roiAvg)),
    statCard('Posições abertas', s.openPositions, `${fmtUsdCompact(s.invested)} investidos`),
    statCard('Trades recentes', s.tradeCount, `${s.tradesPerDay7d.toFixed(1)}/dia · 7d`),
    statCard('Ticket médio', fmtUsdCompact(s.avgTradeSize), `${fmtPct(s.buyRatio)} compras`),
    statCard('Último trade', s.lastTradeAt ? timeAgo(s.lastTradeAt) : '—', ''),
  ].join('');

  $('#pos-table tbody').innerHTML =
    w.positions
      .map(
        (p) => `<tr>
        <td>${esc(p.title)}</td>
        <td>${esc(p.outcome || '—')}</td>
        <td class="num mono">${fmtCents(p.avgPrice)}</td>
        <td class="num mono">${fmtCents(p.curPrice)}</td>
        <td class="num mono">${fmtUsdCompact(p.currentValue)}</td>
        <td class="num mono ${pnlClass(p.cashPnl)}">${fmtUsdCompact(p.cashPnl)} (${p.percentPnl >= 0 ? '+' : ''}${p.percentPnl.toFixed(0)}%)</td>
      </tr>`
      )
      .join('') || '<tr><td colspan="6" class="empty">Sem posições abertas.</td></tr>';

  $('#act-table tbody').innerHTML =
    w.activity
      .filter((a) => a.type === 'TRADE')
      .slice(0, 40)
      .map(
        (a) => `<tr>
        <td class="mono">${timeAgo(a.timestamp)}</td>
        <td class="${a.side === 'BUY' ? 'side-buy' : 'side-sell'}">${a.side === 'BUY' ? '▲' : '▼'}</td>
        <td>${esc(a.outcome || '')} · ${esc(a.title)}</td>
        <td class="num mono">${fmtCents(a.price)}</td>
        <td class="num mono">${fmtUsdCompact(a.usdcSize)}</td>
      </tr>`
      )
      .join('') || '<tr><td colspan="5" class="empty">Sem trades recentes.</td></tr>';

  drawSparkline(await api(`/api/history?address=${address}`));
}

function drawSparkline(points) {
  const canvas = $('#sparkline');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!points || points.length < 2) {
    $('#spark-note').textContent =
      'coletando snapshots a cada 10 min — deixe o servidor rodando para acumular histórico';
    return;
  }
  const first = points[0].pnl;
  const last = points[points.length - 1].pnl;
  $('#spark-note').textContent = `${points.length} snapshots · variação ${fmtUsdCompact(last - first)}`;

  const vals = points.map((p) => p.pnl);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = canvas.width;
  const H = canvas.height;
  const x = (i) => (i / (points.length - 1)) * (W - 6) + 3;
  const y = (v) => H - 5 - ((v - min) / range) * (H - 10);

  const up = last >= first;
  ctx.strokeStyle = up ? '#2bff9e' : '#ff4d6b';
  ctx.lineWidth = 2;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
}

$('#wallet-go').addEventListener('click', () => {
  const addr = $('#wallet-input').value.trim();
  if (addr) openWallet(addr, null);
});
$('#wallet-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#wallet-go').click();
});

// ───────────────────────── watchlist ─────────────────────────

async function loadWatchlist() {
  const list = await api('/api/watchlist');
  $('#watchlist').innerHTML =
    list
      .map(
        (w) => `<div class="watch-item">
        <span class="avatar">${esc((w.name || w.address).slice(0, 2).toUpperCase())}</span>
        <div class="grow" data-addr="${esc(w.address)}" data-name="${esc(w.name || '')}">
          <div class="trader-name">${esc(w.name || shortAddr(w.address))}</div>
          <div class="trader-addr mono">${shortAddr(w.address)}</div>
        </div>
        <span class="x" data-addr="${esc(w.address)}" title="remover">✕</span>
      </div>`
      )
      .join('') ||
    '<div class="empty">Nenhuma carteira monitorada ainda. Abra uma carteira e clique em “+ monitorar”.</div>';

  $('#watchlist').querySelectorAll('.grow').forEach((el) =>
    el.addEventListener('click', () => openWallet(el.dataset.addr, el.dataset.name || null))
  );
  $('#watchlist').querySelectorAll('.x').forEach((el) =>
    el.addEventListener('click', async () => {
      await api('/api/watchlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: el.dataset.addr }),
      });
      loadWatchlist();
    })
  );
}

$('#watch-btn').addEventListener('click', async () => {
  if (!currentWallet) return;
  await api('/api/watchlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(currentWallet),
  });
  loadWatchlist();
});

// ───────────────────────── kalshi ─────────────────────────

async function loadKalshi() {
  const data = await api('/api/kalshi');
  $('#kalshi-table tbody').innerHTML = data.markets
    .map((m) => {
      const delta = m.lastPrice - m.prevPrice;
      return `<tr>
        <td><div class="trader-name" title="${esc(m.title)}">${esc(m.title)}</div>
            <div class="trader-addr mono">${esc(m.ticker)}${m.subtitle ? ' · ' + esc(m.subtitle) : ''}</div></td>
        <td class="num mono">${m.lastPrice}¢</td>
        <td class="num mono ${pnlClass(delta)}">${delta >= 0 ? '+' : ''}${delta}¢</td>
        <td class="num mono">${fmtUsdCompact(m.volume24h)}</td>
      </tr>`;
    })
    .join('');
}

// ───────────────────────── boot ─────────────────────────

async function boot() {
  await Promise.allSettled([loadLeaderboard(), loadFeed(), loadWatchlist(), loadKalshi()]);
  setInterval(loadFeed, FEED_INTERVAL_MS);
  setInterval(loadLeaderboard, FEED_INTERVAL_MS * 5);
  setInterval(loadKalshi, FEED_INTERVAL_MS * 5);
}

boot();
