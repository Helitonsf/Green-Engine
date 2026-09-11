import { apiFootballConfigured, apiFootballLeagues, apiFootballSports, apiFootballFixture } from "../cloudflare/providers/api-football.js";
import { apiFootballHistory } from "../cloudflare/providers/api-football-history.js";
import { isAllowedLeague } from "../cloudflare/providers/league-catalog.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const CACHE_TTL = { sports: 120, leagues: 3600, fixture: 60, history: 300 };

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, "Cache-Control": "no-store", ...extraHeaders } });
}

function cors(request, response, env) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.ALLOWED_ORIGINS || "").split(",").map(o => o.trim()).filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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

async function sports(url, env) {
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Data invalida. Use AAAA-MM-DD." }, 400);
  }
  if (!apiFootballConfigured(env)) {
    return json({
      error: "API_FOOTBALL_KEY nao esta configurada no Cloudflare.",
      providerMode: "api-football"
    }, 500);
  }

  const result = await apiFootballSports(date, env);
  const data = (Array.isArray(result?.data) ? result.data : []).filter(fixture => isAllowedLeague(fixture?.league || {}));

  if (!data.length) {
    return json({
      error: "Nenhum jogo encontrado para esta data no API-Football dentro do catalogo Green Engine.",
      providerMode: "api-football",
      sources: {
        apiFootball: {
          configured: true,
          count: 0,
          status: result?.diagnostic?.status ?? null,
          errors: result?.diagnostic?.errors ?? null
        }
      }
    }, 404);
  }

  return json({
    providerMode: "api-football",
    data,
    sources: {
      apiFootball: {
        configured: true,
        count: data.length,
        status: result?.diagnostic?.status ?? null,
        errors: result?.diagnostic?.errors ?? null
      }
    },
    meta: {
      total: data.length,
      date,
      timezone: "America/Sao_Paulo",
      leagueFilter: "curated",
      provider: "api-football"
    }
  }, 200);
}

async function leagues(env) {
  if (!apiFootballConfigured(env)) {
    return json({ error: "API_FOOTBALL_KEY nao esta configurada no Cloudflare." }, 500);
  }
  const result = await apiFootballLeagues(env);
  const data = Array.isArray(result) ? result : [];
  return json({
    providerMode: "api-football",
    sources: {
      apiFootball: {
        configured: true,
        count: data.length,
        status: result?.diagnostic?.status ?? null,
        errors: result?.diagnostic?.errors ?? null
      }
    },
    data,
    availableLeagueCount: data.length,
    catalog: { type: "curated", genders: ["male", "female", "mixed"], priorities: ["A", "B"] }
  }, 200);
}

async function fixture(url, env) {
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return json({ error: "Informe um fixture ID numerico." }, 400);
  if (!apiFootballConfigured(env)) return json({ error: "API_FOOTBALL_KEY nao esta configurada no Cloudflare." }, 500);
  const data = await apiFootballFixture(id, env);
  if (!data) return json({ error: "API-Football nao encontrou o fixture solicitado ou a liga nao esta no catalogo Green Engine." }, 404);
  if (!isAllowedLeague(data?.league || {})) return json({ error: "A liga do fixture nao esta no catalogo Green Engine." }, 404);
  return json({ provider: "api-football", data }, 200);
}

async function history(url, env) {
  const fixtureId = url.searchParams.get("fixture");
  if (!fixtureId || !/^\d+$/.test(fixtureId)) return json({ error: "Informe um fixture ID numerico." }, 400);
  if (!apiFootballConfigured(env)) return json({ error: "API_FOOTBALL_KEY nao esta configurada no Cloudflare." }, 500);
  const result = await apiFootballHistory(fixtureId, env);
  return json(result.body, result.statusCode);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return cors(request, json({ ok: true }), env);
    const url = new URL(request.url);
    let response;
    if (url.pathname === "/api/sports") response = await withCache(request, ctx, CACHE_TTL.sports, () => sports(url, env));
    else if (url.pathname === "/api/leagues") response = await withCache(request, ctx, CACHE_TTL.leagues, () => leagues(env));
    else if (url.pathname === "/api/fixture") response = await withCache(request, ctx, CACHE_TTL.fixture, () => fixture(url, env));
    else if (url.pathname === "/api/history") response = await withCache(request, ctx, CACHE_TTL.history, () => history(url, env));
    else if (url.pathname === "/health") response = json({ ok: true, service: "green-engine-v6.3.16", timezone: "America/Sao_Paulo", leagueFilter: "curated", provider: "api-football" }, 200);
    else response = json({ error: "Rota nao encontrada." }, 404);
    return cors(request, response, env);
  }
};