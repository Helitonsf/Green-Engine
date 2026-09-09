import { historyCore } from "../cloudflare/history-core.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

const FETCH_TIMEOUT_MS = 10000;

// TTL de cache por endpoint (segundos). Ajustável sem mexer na lógica.
const CACHE_TTL = {
  sports: 120,   // lista de jogos do dia
  leagues: 3600, // catálogo de ligas disponível no token
  fixture: 60,   // dados de um fixture (placar/estado podem mudar perto do jogo)
  history: 300   // histórico das últimas 5 partidas válidas por equipe
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", ...extraHeaders }
  });
}

/**
 * fetch com timeout via AbortController.
 * Sem isso, uma SportMonks lenta/travada deixaria a requisição do worker
 * pendurada indefinidamente.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * CORS por allowlist (env.ALLOWED_ORIGINS, separado por vírgula).
 * O dashboard chama a própria API via caminho relativo (mesma origem) e
 * não depende destes headers para funcionar — eles só importam se algum
 * site/ferramenta externa for consumir a API a partir do navegador.
 * Sem ALLOWED_ORIGINS configurado, nenhuma origem cross-site é liberada.
 */
function cors(request, response, env) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");

  const allowedOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Serve uma resposta cacheada (Cloudflare Cache API) quando existir, senão
 * calcula via computeFn, cacheia (apenas respostas 200) e devolve.
 * Só se aplica a requisições GET, que é o único método usado nestas rotas.
 */
async function withCache(request, ctx, ttlSeconds, computeFn) {
  if (request.method !== "GET" || !ttlSeconds) {
    return computeFn();
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, request);

  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  let response = await computeFn();

  if (response.status === 200) {
    response = new Response(response.body, response);
    response.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

async function fetchSportMonksJson(endpoint) {
  try {
    const response = await fetchWithTimeout(endpoint);
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return { ok: response.ok, status: response.status, data };

  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        data: { error: "Tempo limite excedido ao consultar a SportMonks." }
      };
    }

    return {
      ok: false,
      status: 502,
      data: {
        error: "Falha de rede ao consultar a SportMonks.",
        details: error?.message || String(error)
      }
    };
  }
}

async function sports(url, env) {
  const date = url.searchParams.get("date");

  if (!env.SPORTMONKS_API_TOKEN) {
    return json({
      error: "SPORTMONKS_API_TOKEN nao esta configurado no Cloudflare."
    }, 500);
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({
      error: "Data invalida. Use AAAA-MM-DD."
    }, 400);
  }

  const baseEndpoint =
    `https://api.sportmonks.com/v3/football/fixtures/date/${date}` +
    `?api_token=${encodeURIComponent(env.SPORTMONKS_API_TOKEN)}` +
    `&per_page=50&page=1` +
    `&timezone=America/Sao_Paulo` +
    `&include=participants`;

  const firstResult = await fetchSportMonksJson(baseEndpoint);

  if (!firstResult.ok) {
    return json({
      error: firstResult.status === 504
        ? firstResult.data.error
        : "SportMonks retornou um erro.",
      details: firstResult.data
    }, firstResult.status);
  }

  const firstData = firstResult.data || {};
  const allFixtures = Array.isArray(firstData.data)
    ? [...firstData.data]
    : [];
  const pagination = firstData.meta?.pagination || {};
  const lastPage = Number(pagination.last_page || 1);

  // O endpoint é paginado (máx. 50 por página). Reunimos todas as páginas
  // disponíveis para que o seletor diário não fique limitado à primeira.
  for (let page = 2; page <= lastPage && page <= 20; page += 1) {
    const pageEndpoint =
      `https://api.sportmonks.com/v3/football/fixtures/date/${date}` +
      `?api_token=${encodeURIComponent(env.SPORTMONKS_API_TOKEN)}` +
      `&per_page=50&page=${page}` +
      `&timezone=America/Sao_Paulo` +
      `&include=participants`;

    const pageResult = await fetchSportMonksJson(pageEndpoint);

    if (!pageResult.ok) {
      return json({
        error: pageResult.status === 504
          ? pageResult.data.error
          : "SportMonks retornou um erro ao paginar os jogos.",
        details: pageResult.data
      }, pageResult.status);
    }

    const pageFixtures = Array.isArray(pageResult.data?.data)
      ? pageResult.data.data
      : [];

    allFixtures.push(...pageFixtures);
  }

  return json({
    ...firstData,
    data: allFixtures,
    meta: {
      ...(firstData.meta || {}),
      pagination: {
        ...(pagination || {}),
        total: allFixtures.length,
        current_page: 1,
        last_page: lastPage,
        has_more: false
      }
    }
  }, 200);
}

async function leagues(env) {
  if (!env.SPORTMONKS_API_TOKEN) {
    return json({
      error: "SPORTMONKS_API_TOKEN nao esta configurado no Cloudflare."
    }, 500);
  }

  const endpoint =
    "https://api.sportmonks.com/v3/football/leagues" +
    `?api_token=${encodeURIComponent(env.SPORTMONKS_API_TOKEN)}` +
    "&include=currentSeason";

  const result = await fetchSportMonksJson(endpoint);

  if (!result.ok) {
    return json({
      error: result.status === 504
        ? result.data.error
        : "SportMonks retornou um erro ao buscar as ligas disponíveis.",
      details: result.data
    }, result.status);
  }

  const data = result.data || {};
  const availableLeagues = Array.isArray(data.data)
    ? data.data.map(league => ({
        id: league.id,
        name: league.name,
        shortCode: league.short_code || null,
        active: league.active !== false,
        type: league.type || null,
        subType: league.sub_type || null,
        countryId: league.country_id ?? null,
        currentSeasonId: league.currentseason?.id ?? league.currentSeason?.id ?? null
      }))
    : [];

  return json({
    ...data,
    data: availableLeagues,
    availableLeagueCount: availableLeagues.length
  }, 200);
}

async function fixture(url, env) {
  const id = url.searchParams.get("id");

  if (!env.SPORTMONKS_API_TOKEN) {
    return json({
      error: "SPORTMONKS_API_TOKEN nao esta configurado no Cloudflare."
    }, 500);
  }

  if (!id || !/^\d+$/.test(id)) {
    return json({
      error: "Informe um fixture ID numerico."
    }, 400);
  }

  const include = "participants;league.country;league;state;statistics;events;lineups";

  const endpoint =
    `https://api.sportmonks.com/v3/football/fixtures/${id}` +
    `?api_token=${encodeURIComponent(env.SPORTMONKS_API_TOKEN)}&per_page=50` +
    `&include=${encodeURIComponent(include)}`;

  const result = await fetchSportMonksJson(endpoint);

  if (!result.ok) {
    return json({
      error: result.status === 504
        ? result.data.error
        : "SportMonks retornou um erro ao buscar o fixture.",
      details: result.data
    }, result.status);
  }

  return json(result.data, 200);
}

async function history(url, env) {
  const id = url.searchParams.get("fixture");

  if (!id) {
    return json({
      error: "Informe o fixture ID."
    }, 400);
  }

  if (!/^\d+$/.test(id)) {
    return json({
      error: "Fixture ID invalido."
    }, 400);
  }

  if (!env.SPORTMONKS_API_TOKEN) {
    return json({
      error: "SPORTMONKS_API_TOKEN nao esta configurado no Cloudflare."
    }, 500);
  }

  const result = await historyCore(id, env.SPORTMONKS_API_TOKEN);

  return json(result.body, result.statusCode);
}

async function serveAsset(request, env) {
  if (!env.ASSETS) {
    return json({
      ok: false,
      error: "ASSETS binding nao configurado."
    }, 500);
  }

  const response = await env.ASSETS.fetch(request);

  const contentType = response.headers.get("Content-Type");

  if (
    contentType &&
    contentType.toLowerCase().startsWith("text/html") &&
    !contentType.toLowerCase().includes("charset=")
  ) {
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "text/html; charset=utf-8");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(request, new Response(null, { status: 204 }), env);
    }

    try {
      if (url.pathname === "/api/health") {
        return cors(request, json({
          ok: true,
          version: "6.3.16-CF",
          sportmonksConfigured: Boolean(env.SPORTMONKS_API_TOKEN),
          assetsConfigured: Boolean(env.ASSETS),
          message: "Green Engine Cloudflare Worker ativo"
        }), env);
      }

      if (url.pathname === "/api/sports") {
        const response = await withCache(request, ctx, CACHE_TTL.sports, () => sports(url, env));
        return cors(request, response, env);
      }

      if (url.pathname === "/api/leagues") {
        const response = await withCache(request, ctx, CACHE_TTL.leagues, () => leagues(env));
        return cors(request, response, env);
      }

      if (url.pathname === "/api/fixture") {
        const response = await withCache(request, ctx, CACHE_TTL.fixture, () => fixture(url, env));
        return cors(request, response, env);
      }

      if (url.pathname === "/api/history") {
        const response = await withCache(request, ctx, CACHE_TTL.history, () => history(url, env));
        return cors(request, response, env);
      }

      return await serveAsset(request, env);

    } catch (error) {
      return cors(request, json({
        ok: false,
        error: "Erro interno do Worker.",
        details: error?.message || String(error)
      }, 500), env);
    }
  }
};