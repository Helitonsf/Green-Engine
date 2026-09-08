# Green Engine v6.3.16 — Motor Estatístico

Dashboard de análise pré-jogo de futebol. Estima probabilidades por mercado
(Poisson + frequência empírica das últimas partidas válidas) e nunca usa odds
no cálculo — odds são fora de escopo até que uma fonte seja conectada
(ver seção "Surebet" no dashboard).

Stack: **Cloudflare Worker** (`worker/index.js`) servindo os assets estáticos
de `public/` e as rotas `/api/*`, que consultam a **SportMonks API**.

## ⚠️ Antes de tudo: rotacione o token da SportMonks

Um `.dev.vars` com um token real acabou circulando fora do repositório (fora
do controle do `.gitignore`, por ter sido incluído em um backup/zip). Gere um
novo token no painel da SportMonks e substitua em todo lugar antes de seguir
usando este projeto em produção.

## Rodando localmente

```bash
npm install
cp .dev.vars.example .dev.vars   # preencha com seu token da SportMonks
npx wrangler dev
```

Isso sobe o worker localmente (por padrão em `http://localhost:8787`),
servindo tanto o dashboard quanto as rotas de API.

## Deploy

```bash
npx wrangler secret put SPORTMONKS_API_TOKEN   # uma vez, em produção
npx wrangler deploy
```

## Testes funcionais / CI

Os scripts em `tests/` agora usam `node:assert` de verdade (antes só
imprimiam JSON pra inspeção manual) e retornam exit code `1` se alguma
regressão for detectada. Rodam via `node tests/arquivo.mjs`, sem precisar de
token real nem de rede (tudo mockado).

Um workflow do GitHub Actions (`.github/workflows/tests.yml`) roda a
verificação de sintaxe e todos os testes em todo `push`/`pull request`.

## Estrutura

```
worker/index.js            Roteamento HTTP, chamadas à SportMonks, CORS, cache
cloudflare/history-core.js Motor de histórico + Green Score (Poisson + empírico)
public/index.html          Dashboard
public/games-search-controller.js  Busca de jogos por data
tests/*.mjs                Scripts de teste manual do history-core (node tests/arquivo.mjs)
```

## Variáveis de ambiente

| Nome                  | Obrigatória | Descrição                                                                 |
|-----------------------|:-----------:|-----------------------------------------------------------------------------|
| `SPORTMONKS_API_TOKEN`| Sim         | Token da SportMonks API (secret)                                            |
| `ALLOWED_ORIGINS`     | Não         | Origens externas (separadas por vírgula) autorizadas a chamar `/api/*` via CORS. O próprio dashboard não precisa disso — chama a API pela mesma origem. |

## Rotas da API

| Rota            | Parâmetros      | Cache  | Descrição                                   |
|------------------|-----------------|--------|----------------------------------------------|
| `/api/health`    | —               | não    | Status do worker                              |
| `/api/sports`    | `date=AAAA-MM-DD` | 120s | Jogos do dia                                  |
| `/api/fixture`   | `id`            | 60s    | Dados de um fixture                           |
| `/api/history`   | `fixture=ID`    | 300s   | Histórico das 5 últimas partidas válidas por equipe + Green Score |

## Changelog

### v6.3.1 – v6.3.7 (base Netlify)
- Introdução do histórico casa/fora, exclusão do fixture atual da amostra,
  fallback de até 730 dias quando faltam placares válidos, amostra oficial
  fixa em 5 partidas válidas por equipe.

### v6.3.14 – Confidence & Market Ranking
- `overall` removido; cada mercado tem `probability` e `score` (Confidence
  Score) próprios, considerando amostra, consistência histórica, concordância
  modelo × frequência, estabilidade leave-one-out e margem de incerteza.
- `recommendedMarket` só é liberado quando atende aos critérios mínimos de
  segurança; odds continuam fora do cálculo.

### v6.3.15 – v6.3.16 (migração Cloudflare)
- Migração de Netlify Functions para Cloudflare Worker + Pages Assets.
- Diversos refinamentos visuais incrementais no dashboard (checkpoints
  `C.64.x`).

### Sessão atual (não numerada ainda)
- **Correção de encoding**: todo o texto acentuado do dashboard e os
  comentários/mensagens do `history-core.js` estavam em mojibake (UTF-8
  double/triple-encoded). Corrigido em todo o arquivo ativo.
- **Correção de HTML**: removida uma tag `</button>` órfã na seção de busca
  de jogos (herdada de uma versão antiga).
- **Redesign completo do dashboard** (`public/index.html`): layout em 3
  colunas (busca/filtros/resumo à esquerda, confronto + tabela de mercados no
  centro, validação do modelo + Confidence Score à direita), mantendo 100% de
  compatibilidade com `games-search-controller.js`.
  - Tabela de mercados agora ordenável por coluna (Mercado, Prob. Modelo,
    Odd Justa, Confiança).
  - Estados de carregamento (skeleton) no card do confronto, no card de
    mercado recomendado e na tabela.
  - Regiões `aria-live`/`role="status"`/`role="alert"` para leitores de tela.
  - Colunas que dependem de uma fonte de odds ainda não conectada (Prob.
    Implícita, Odd Atual, Valor) aparecem como "—", nunca com números
    inventados.
- **Robustez do backend** (`worker/index.js`, `cloudflare/history-core.js`):
  - Timeout de 10s em todas as chamadas à SportMonks (antes podiam ficar
    penduradas indefinidamente); retorna `504` com mensagem clara em caso de
    timeout.
  - CORS trocado de `*` (qualquer origem) para uma allowlist via
    `ALLOWED_ORIGINS`; sem essa variável, nenhuma origem cross-site é
    liberada (o próprio dashboard não é afetado, pois chama a API pela mesma
    origem).
  - Cache via Cloudflare Cache API em `/api/sports` (120s), `/api/fixture`
    (60s) e `/api/history` (300s), reduzindo consumo de cota da SportMonks em
    consultas repetidas.
- **Limpeza do projeto**: removidos ~379 MB de artefatos que não deveriam
  fazer parte do pacote — `node_modules/`, estado local do `.wrangler/`,
  dezenas de pastas de backup incrementais (`backup-*`, `_layout-backup-*`,
  `_release-backup-*`, `temp-*`) e arquivos `.pre-*`/`.before-*` soltos,
  funções Netlify legadas (não usadas desde a migração para Cloudflare) e
  variantes de teste corrompidas/duplicadas.
