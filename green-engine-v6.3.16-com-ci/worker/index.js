import { historyCore } from "../cloudflare/history-core.js";
import { apiFootballConfigured, apiFootballLeagues, apiFootballSports, apiFootballFixture } from "../cloudflare/providers/api-football.js";
import { apiFootballHistory } from "../cloudflare/providers/api-football-history.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

const FETCH_TIMEOUT_MS = 10000;

const CACHE_TTL = {
  sports: 120,
  leagues: 3600,
  fixture: 60,
  history: 300
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", ...extraHeaders }
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

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

async function withCache(request, ctx, ttlSeconds, computeFn) {
  if (request.method !== "GET" || !ttlSeconds) return computeFn();

  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

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
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, status: 504, data: { error: "Tempo limite excedido ao consultar a SportMonks." } };
    }
    return {
      ok: false,
      status: 502,
      data: { error: "Falha de rede ao consultar a SportMonks.", details: error?.message || String(error) }
    };
  }
}

async function sports(url, env) {
  const date = url.searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Data invalida. Use AAAA-MM-DD." }, 400);
  }

  const sportmonksFixtures = [];
  let sportmonksError = null;

  if (env.SPORTMONKS_API_TOKEN) {
    const baseEndpoint =
      `https://api.sportmonks.com/v3/football/fixtures/date/${date}` +
      `?api_token=${encodeURIComponent(env.SPORTMONKS_API_TOKEN)}` +
      `&per_page=50&page=1&timezone=America/Sao_Paulo&include=participants`;

    const firstResult = await fetchSportMonksJson(baseEndpoint);
    if (firstResult.ok) {
      const firstData = firstResult.data || {};
      sportmonksFixtures.push(...(Array.isArray(firstData.data) ? firstData.data : []));
      const pagination = firstData.meta?.pagination || {};
      const lastPage = Number(pagination.last_page || 1);

      for (let page = 2; page <= lastPage && page <= 20; page += 1) {
        const pageEndpoint =
          `https://api.sportmonks.com/v3/football/fixtures/date/${date}` +
          `?api_token=${encodeURIComponent(env.SPORTMONKS_API_TOKEN)}` +
          `&per_page=50&page=${page}&timezone=America/Sao_Paulo&include=participants`;
        const pageResult = await fetchSportMonksJson(pageEndpoint);
        if (!pageResult.ok) {
          sportmonksError = pageResult.data;
          break;
        }
        sportmonksFixtures.push(...(Array.isArray(pageResult.data?.data) ? pageResult.data.data : []));
      }
    } else {
      sportmonksError = firstResult.data;
    }
  }

  const normalizedSportMonks = sportmonksFixtures.map(fixture => ({
    ...fixture,
    provider: "sportmonks"
  }));

  const apiFootball = apiFootballConfigured(env)
    ? await apiFootballSports(date, env)
    : null;

  const apiFootballFixtures = apiFootball?.data || [];
  const combined = [...normalizedSportMonks, ...apiFootballFixtures];

  if (!combined.length) {
    return json({
      error: "Nenhum jogo encontrado para esta data nos provedores configurados.",
      sources: {
        sportmonks: { configured: Boolean(env.SPORTMONKS_API_TOKEN), count: 0, error: sportmonksError },
        apiFootball: { configured: apiFootballConfigured(env), count: apiFootballFixtures.length, status: apiFootball?.diagnostic?.status ?? null, errors: apiFootball?.diagnostic?.errors ?? null }
      }
    }, 404);
  }

  return json({
    providerMode: apiFootballFixtures.length ? "hybrid" : "sportmonks",
    data: combined,
    sources: {
      sportmonks: { configured: Boolean(env.SPORTMONKS_API_TOKEN), count: normalizedSportMonks.length },
      apiFootball: { configured: apiFootballConfigured(env), count: apiFootballFixtures.length, status: apiFootball?.diagnostic?.status ?? null, errors: apiFootball?.diagnostic?.errors ?? null }
    },
    meta: {
      total: combined.length,
      date,
      timezone: "America/Sao_Paulo"
    }
  }, 200);
}

async function leagues(env) {
  if (!env.SPORTMONKS_API_TOKEN && !apiFootballConfigured(env)) {
    return json({ error: "Nenhum provedor de futebol esta configurado no Cloudflare." }, 500);
  }

  let sportmonksLeagues = [];
  if (env.SPORTMONKS_API_TOKEN) {
    const endpoint =
      "https://api.sportmonks.com/v3/football/leagues" +
      `?api_token=${encodeURIComponent(env.SPORTMONKS_API_TOKEN)}&include=currentSeason`;
    const result = await fetchSportMonksJson(endpoint);
    if (result.ok) {
      const data = result.data || {};
      sportmonksLeagues = Array.isArray(data.data)
        ? data.data.map(league => ({
            provider: "sportmonks",
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
    }
  }

  const apiFootball = apiFootballConfigured(env)
    ? await apiFootballLeagues(env)
    : [];

  return json({
    providerMode: apiFootball.length ? "hybrid" : "sportmonks",
    sources: {
      sportmonks: { configured: Boolean(env.SPORTMONKS_API_TOKEN), count: sportmonksLeagues.length },
      apiFootball: { configured: apiFootballConfigured(env), count: apiFootball.length, status: apiFootball?.diagnostic?.status ?? null, errors: apiFootball?.diagnostic?.errors ?? null }
    },
    data: [...sportmonksLeagues, ...apiFootball],
    availableLeagueCount: sportmonksLeagues.length + apiFootball.length
  }, 200);
}

async function fixture(url, env) {
  const id = url.searchParams.get("id");
  const provider = (url.searchParams.get("provider") || "sportmonks").toLowerCase();

  if (!id || !/^\d+$/.test(id)) return json({ error: "Informe um fixture ID numerico." }, 400);

  if (provider === "api-football") {
    if (!apiFootballConfigured(env)) return json({ error: "API_FOOTBALL_KEY nao esta configurada no Cloudflare." }, 500);
    const data = await apiFootballFixture(id, env);
    if (!data) return json({ error: "API-Football nao encontrou o fixture solicitado." }, 404);
    return json({ provider: "api-football", data }, 200);
  }

  if (!env.SPORTMONKS_API_TOKEN) {
    return json({ error: "SPORTMONKS_API_TOKEN nao esta configurado no Cloudflare." }, 500);
  }

  const include = "participants;league.country;league;state;statistics;events;lineups";
  const endpoint =
    `https://api.sportmonks.com/v3/football/fixtures/${id}` +
    `?api_token=${encodeURIComponent(env.SPORTMONKS_API_TOKEN)}&per_page=50&include=${encodeURIComponent(include)}`;
  const result = await fetchSportMonksJson(endpoint);
  if (!result.ok) {
    return json({
      error: result.status === 504 ? result.data.error : "SportMonks retornou um erro ao buscar o fixture.",
      details: result.data
    }, result.status);
  }
  return json({ provider: "sportmonks", ...result.data }, 200);
}

async function history(url, env) {
  const id = url.searchParams.get("fixture");
  const provider = (url.searchParams.get("provider") || "sportmonks").toLowerCase();
  if (!id) return json({ error: "Informe o fixture ID." }, 400);
  if (!/^\d+$/.test(id)) return json({ error: "Fixture ID invalido." }, 400);

  if (provider === "api-football") {
    const result = await apiFootballHistory(id, env);
    return json(result.body, result.statusCode);
  }

  if (!env.SPORTMONKS_API_TOKEN) return json({ error: "SPORTMONKS_API_TOKEN nao esta configurado no Cloudflare." }, 500);

  const result = await historyCore(id, env.SPORTMONKS_API_TOKEN);
  return json(result.body, result.statusCode);
}

async function serveAsset(request, env) {
  if (!env.ASSETS) return json({ ok: false, error: "ASSETS binding nao configurado." }, 500);
  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get("Content-Type");
  if (contentType && contentType.toLowerCase().startsWith("text/html") && !contentType.toLowerCase().includes("charset=")) {
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(request, new Response(null, { status: 204 }), env);

    try {
      if (url.pathname === "/api/health") {
        return cors(request, json({
          ok: true,
          version: "6.3.16-CF",
          sportmonksConfigured: Boolean(env.SPORTMONKS_API_TOKEN),
          apiFootballConfigured: apiFootballConfigured(env),
          providerMode: apiFootballConfigured(env) ? "hybrid-ready" : "sportmonks-only",
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
