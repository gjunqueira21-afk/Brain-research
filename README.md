# ⚡ ALPHA RADAR — Copy-Trading Dashboard (Polymarket × Kalshi)

Dashboard com UX futurista que monitora as carteiras que mais performam no
**Polymarket**, mostra as **novas posições** que elas abrem em tempo quase real
e acompanha a **performance** delas para você validar se continuam acertando
antes de copiar os trades.

## 🚀 Como rodar

```bash
node server.js
# abra http://localhost:3000
```

Só isso — não tem `npm install`. Requer Node 18 ou superior.

> **Modo demo:** se a máquina não tiver acesso às APIs (firewall/offline), o
> dashboard mostra dados de exemplo com o aviso "MODO DEMO" no topo. Com
> internet normal, ele puxa os dados reais automaticamente.

## 🧭 O que tem no dashboard

| Painel | O que faz |
|---|---|
| **Top Carteiras** | Ranking das carteiras com maior PnL ou volume no Polymarket (24h / 7d / 30d / tudo). Clique em qualquer trader para abrir a análise completa. |
| **Novas Posições** | Feed ao vivo dos trades das carteiras monitoradas (watchlist + top 8 do ranking). Trades novos desde a sua última visita ganham o selo **NOVO**. Atualiza a cada 60s. |
| **Análise da Carteira** | Estatísticas calculadas: PnL total (realizado + aberto), **win rate**, ROI médio por posição, ticket médio, frequência de trades (7d), % de compras, posições abertas com preço de entrada vs atual, e os últimos 40 trades. |
| **Performance** | O servidor tira snapshots do PnL de cada carteira monitorada a cada 10 min e desenha um sparkline — assim você vê se o trader **continua acertando** ou se esfriou. |
| **Watchlist** | Suas carteiras favoritas, persistidas em `data/watchlist.json`. Também dá para colar qualquer endereço `0x…` manualmente. |
| **Kalshi Radar** | Os mercados com maior volume nas últimas 24h no Kalshi, com variação de preço. |

## 📊 Estatísticas calculadas por carteira

- **PnL total** = não-realizado das posições abertas + realizado
- **Win rate** = posições lucrativas ÷ posições com resultado definido
- **ROI médio** = média do `percentPnl` das posições decididas
- **Ticket médio** = volume USDC ÷ número de trades recentes
- **Ritmo** = trades por dia na última semana
- **Viés** = % de ordens de compra vs venda

## 🔌 Fontes de dados (públicas, sem API key)

- `lb-api.polymarket.com/leaderboard` — ranking por PnL/volume
- `data-api.polymarket.com/positions` — posições abertas por carteira
- `data-api.polymarket.com/activity` — histórico de trades por carteira
- `api.elections.kalshi.com/trade-api/v2/markets` — mercados do Kalshi

> ⚠️ **Limitação do Kalshi:** a API pública do Kalshi não expõe dados por
> trader (posições/PnL de outros usuários), então copy-trade por carteira só é
> possível no Polymarket. O painel do Kalshi mostra para onde o volume está
> fluindo.

## 🗂 Estrutura

```
server.js        → servidor HTTP + proxy/agregador das APIs (zero deps)
demo-data.js     → dados de exemplo para o modo offline
public/          → frontend (index.html, style.css, app.js)
data/            → estado local: watchlist, último trade visto, histórico de PnL
```

## ⚠️ Aviso

Isto **não é recomendação de investimento**. Performance passada não garante
resultado futuro — use as estatísticas para filtrar, não para seguir às cegas.
