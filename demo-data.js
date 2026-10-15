/**
 * Dados de demonstração — usados apenas quando as APIs externas estão
 * inacessíveis, para o dashboard continuar navegável. O frontend exibe
 * o aviso "MODO DEMO" quando recebe demo: true.
 */

const NOW = Math.floor(Date.now() / 1000);
const H = 3600;

const TRADERS = [
  { address: '0xdemo000000000000000000000000000000000001', name: 'TheOracle', amount: 1843210 },
  { address: '0xdemo000000000000000000000000000000000002', name: 'gabagool22', amount: 1212450 },
  { address: '0xdemo000000000000000000000000000000000003', name: 'FedWatcher', amount: 887300 },
  { address: '0xdemo000000000000000000000000000000000004', name: 'kappa_prime', amount: 612880 },
  { address: '0xdemo000000000000000000000000000000000005', name: 'MacroMaven', amount: 540120 },
  { address: '0xdemo000000000000000000000000000000000006', name: 'driftking', amount: 433900 },
  { address: '0xdemo000000000000000000000000000000000007', name: 'no_house_edge', amount: 391045 },
  { address: '0xdemo000000000000000000000000000000000008', name: 'SatoshiJr', amount: 287660 },
];

const MARKETS = [
  ['Fed corta juros na reunião de julho?', 'Yes'],
  ['Bitcoin acima de $150k em 31/12?', 'No'],
  ['Eleição presidencial: candidato A vence?', 'Yes'],
  ['Inflação (CPI) acima de 3% em junho?', 'No'],
  ['SpaceX faz lançamento orbital em junho?', 'Yes'],
  ['Petróleo Brent acima de $90 em julho?', 'No'],
  ['ETH acima de $8k até setembro?', 'Yes'],
  ['Shutdown do governo dos EUA em 2026?', 'No'],
];

// gerador pseudoaleatório determinístico (mesma carteira → mesmos números)
function rng(seed) {
  let s = 0;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function wallet(address) {
  const r = rng(address);
  const positions = [];
  const activity = [];

  for (let i = 0; i < 6 + Math.floor(r() * 5); i++) {
    const [title, outcome] = MARKETS[Math.floor(r() * MARKETS.length)];
    const avgPrice = 0.15 + r() * 0.6;
    const drift = (r() - 0.38) * 0.3; // viés positivo: são as carteiras top
    const curPrice = Math.min(0.99, Math.max(0.01, avgPrice + drift));
    const size = Math.round(500 + r() * 30000);
    const initialValue = size * avgPrice;
    const currentValue = size * curPrice;
    positions.push({
      title,
      outcome,
      slug: null,
      icon: null,
      size,
      avgPrice,
      curPrice,
      initialValue,
      currentValue,
      cashPnl: currentValue - initialValue,
      realizedPnl: (r() - 0.35) * 4000,
      percentPnl: ((currentValue - initialValue) / initialValue) * 100,
      endDate: null,
      redeemable: false,
    });
  }

  for (let i = 0; i < 30; i++) {
    const [title, outcome] = MARKETS[Math.floor(r() * MARKETS.length)];
    const price = 0.1 + r() * 0.8;
    const usdcSize = Math.round(200 + r() * 12000);
    activity.push({
      timestamp: NOW - Math.floor(r() * 72 * H),
      type: 'TRADE',
      side: r() > 0.42 ? 'BUY' : 'SELL',
      size: Math.round(usdcSize / price),
      usdcSize,
      price,
      title,
      outcome,
      slug: null,
      txHash: null,
    });
  }
  activity.sort((a, b) => b.timestamp - a.timestamp);

  return { positions, activity };
}

const leaderboard = TRADERS.map((t, i) => ({
  rank: i + 1,
  address: t.address,
  name: t.name,
  pseudonym: t.name,
  avatar: null,
  amount: t.amount,
}));

const kalshi = [
  ['FED-26JUL', 'Fed decision in July?', 'Cut 25bps', 38, 41, 2843000, 9120000],
  ['BTCZ-26DEC', 'Bitcoin above $150k on Dec 31?', '', 22, 19, 1932000, 5480000],
  ['CPI-26JUN', 'CPI above 3.0% in June?', '', 61, 55, 1411000, 3200000],
  ['GOVSHUT-26', 'Government shutdown in 2026?', '', 17, 21, 988000, 2750000],
  ['OIL-90-JUL', 'Brent above $90 in July?', '', 44, 47, 720000, 1990000],
  ['NBA-FIN-26', 'NBA Finals winner?', 'Team X', 55, 51, 689000, 1640000],
  ['ETH-8K-SEP', 'ETH above $8k by September?', '', 31, 28, 540000, 1310000],
  ['HURR-26ATL', '10+ Atlantic hurricanes in 2026?', '', 72, 70, 410000, 980000],
].map(([ticker, title, subtitle, lastPrice, prevPrice, volume24h, openInterest]) => ({
  ticker,
  title,
  subtitle,
  lastPrice,
  prevPrice,
  volume24h,
  openInterest,
  closeTime: null,
}));

module.exports = { leaderboard, wallet, kalshi };
