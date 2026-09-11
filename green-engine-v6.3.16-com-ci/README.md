# Green Engine v6.3.16 — Motor Estatístico

Dashboard de análise pré-jogo de futebol. Estima probabilidades por mercado
(Poisson + frequência empírica das últimas partidas válidas) e nunca usa odds
no cálculo. Odds não limitam, priorizam ou escolhem mercados nesta camada.

Stack: **Cloudflare Worker** (`worker/index.js`) servindo os assets estáticos
de `public/` e as rotas `/api/*`, com **API-Football como único provedor de
futebol**.

## Fonte única de futebol

O Green Engine usa `API_FOOTBALL_KEY` como único segredo de dados de futebol.
Não existe mais dependência operacional de SportMonks.

A cadeia ativa é:

`API-Football fixtures → histórico das equipes → estatísticas → probabilidade por mercado → Confidence Score → ranking global → mercado recomendado`

Odds permanecem fora do cálculo estatístico. O endpoint `/api/markets` consulta
somente o catálogo de tipos de mercados da API-Football; ele não fornece odds
e não aplica faixa de 1,40–1,60 à análise.

## Rodando localmente

```bash
npm install
npx wrangler dev
```

Configure `API_FOOTBALL_KEY` no ambiente local antes de executar o Worker.

## Deploy

```bash
npx wrangler secret put API_FOOTBALL_KEY
npx wrangler deploy
```

## Testes funcionais / CI

Os scripts em `tests/` usam `node:assert` e validam o cálculo estatístico,
ranking e mercados sem depender de um token real ou de SportMonks.

## Estrutura

```
worker/index.js                         Roteamento HTTP, CORS e cache
cloudflare/providers/api-football.js   Fixtures, ligas e catálogo de mercados
cloudflare/providers/api-football-history.js  Histórico e estatísticas API-Football
cloudflare/providers/league-catalog.js Catálogo de ligas elegíveis
cloudflare/history-core.js              Cálculo de mercados + Green Score
public/index.html                       Dashboard
public/games-search-controller.js       Busca de jogos por data
tests/*.mjs                              Testes do motor estatístico
```

## Variáveis de ambiente

| Nome | Obrigatória | Descrição |
|---|:---:|---|
| `API_FOOTBALL_KEY` | Sim | Chave da API-Football |
| `ALLOWED_ORIGINS` | Não | Origens externas autorizadas no CORS |

## Rotas da API

| Rota | Parâmetros | Cache | Descrição |
|---|---|---:|---|
| `/health` | — | não | Status do Worker |
| `/api/sports` | `date=AAAA-MM-DD` | 120s | Jogos elegíveis do dia |
| `/api/fixture` | `id` | 60s | Dados do fixture |
| `/api/history` | `fixture=ID` | 300s | Histórico das 5 últimas partidas válidas por equipe + Green Score |
| `/api/markets` | — | 24h | Catálogo de tipos de mercado + regras do motor |

## Regras atuais do motor

- Análise exclusivamente pré-jogo.
- Histórico e estatísticas vêm da API-Football.
- O fixture atual é excluído do histórico.
- Amostra padrão: 5 partidas válidas por equipe.
- Mercados são comparados globalmente; não há pré-seleção de gols ou escanteios.
- Probabilidade e Confidence Score determinam o ranking.
- `recommendedMarket` exige Confidence Score mínimo de 70, probabilidade mínima de 70% e vantagem mínima de 3 pontos sobre o segundo colocado.
- **Odds não participam do cálculo e não filtram a análise.**
- Surebet é uma camada separada.

## Changelog

### v6.3.16 — API-Football only
- API-Football consolidada como único provedor operacional.
- Núcleo estatístico desacoplado de qualquer SDK/API de fornecedor.
- Dependências e mensagens legadas de SportMonks removidas.
- Catálogo de mercados separado do cálculo de odds.
- Faixa de odds 1,40–1,60 removida da análise.
