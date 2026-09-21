# Green Engine v6.3.16 — Motor Estatístico

Dashboard de análise pré-jogo de futebol. Estima probabilidades por mercado
(Poisson + frequência empírica das últimas partidas válidas) e **nunca usa odds
no cálculo**.

Stack: **Cloudflare Worker** (`worker/index.js`) servindo os assets estáticos
de `public/` e as rotas `/api/*`, com **football-data.org como único provedor**.

## Fonte de dados (football-data only)

A API-Football foi **removida** do fluxo operacional (plano free ~100 req/dia
estourava constantemente). O projeto usa apenas:

- `FOOTBALL_DATA_API_KEY` — football-data.org (12 competições free)

Competições free: PL, PD (La Liga), BL1, SA, FL1, DED, PPL, ELC, BSA
(Brasileirão), CL, WC, EC.

Odds estão **desativadas** nesta versão.

A cadeia ativa é:

`football-data matches → histórico das equipes (placares) → probabilidade por mercado → Confidence Score → ranking → mercado recomendado`

## Rodando localmente

```bash
npm install
npx wrangler secret put FOOTBALL_DATA_API_KEY   # se ainda não tiver
npx wrangler dev
```

## Deploy

```bash
npx wrangler secret put FOOTBALL_DATA_API_KEY
npx wrangler deploy
```

## Testes / CI

Os scripts em `tests/` usam `node:assert` e validam o cálculo estatístico
sem depender de token real.

## Estrutura

```
worker/index.js                              Roteamento HTTP, CORS e cache
cloudflare/providers/football-data.js        Jogos, fixture, times (12 ligas)
cloudflare/providers/football-data-history.js Histórico + Green Score
cloudflare/history-core.js                   Cálculo de mercados + Green Score
public/index.html                            Dashboard
public/games-search-controller.js            Busca de jogos por data
tests/*.mjs                                  Testes do motor estatístico
```

Arquivos legados de API-Football (`api-football*.js`, `team-history.js`,
`league-catalog.js`) permanecem no repositório mas **não são importados**
pelo worker.

## Variáveis de ambiente

| Nome | Obrigatória | Descrição |
|---|:---:|---|
| `FOOTBALL_DATA_API_KEY` | Sim | Chave do football-data.org |
| `ALLOWED_ORIGINS` | Não | Origens externas autorizadas no CORS |

## Rotas da API

| Rota | Parâmetros | Cache | Descrição |
|---|---|---:|---|
| `/health` | — | não | Status do Worker |
| `/api/sports` | `date=AAAA-MM-DD` | 120s | Jogos do dia (12 ligas free) |
| `/api/fixture` | `id` (+ date/home/away) | 60s | Dados do fixture |
| `/api/history` | `fixture=ID` | 300s | Histórico + Green Score |
| `/api/leagues` | — | 1h | Lista das 12 competições free |
| `/api/markets` | — | 24h | Famílias estatísticas do motor |

## Regras atuais do motor

- Análise exclusivamente pré-jogo.
- Histórico vem de placares finalizados (football-data).
- O fixture atual é excluído do histórico.
- Amostra padrão: 5 partidas válidas por equipe (mínimo).
- Probabilidade e Confidence Score determinam o ranking.
- `recommendedMarket` exige Confidence Score ≥ 70, probabilidade ≥ 70% e
  vantagem mínima de 3 pontos sobre o segundo colocado.
- **Odds não participam do cálculo** (e estão desativadas nesta versão).

## Changelog

### v6.3.16 — football-data only
- API-Football removida do worker (sports, fixture, history, odds).
- Única fonte: football-data.org (12 ligas free).
- Odds desativadas até nova fonte.
- Mensagens de UI e `/health` atualizados.
