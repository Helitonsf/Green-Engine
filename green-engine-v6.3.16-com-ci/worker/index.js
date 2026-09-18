import { apiFootballConfigured, apiFootballLeagues, apiFootballBetTypes, apiFootballSports, apiFootballFixture } from "../cloudflare/providers/api-football.js";
import { apiFootballHistory } from "../cloudflare/providers/api-football-history.js";
import { isAllowedLeague } from "../cloudflare/providers/league-catalog.js";
import { footballDataConfigured, footballDataSports, footballDataFixture } from "../cloudflare/providers/football-data.js";
import { footballDataHistory } from "../cloudflare/providers/football-data-history.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const CACHE_TTL = { sports: 120, leagues: 3600, markets: 86400, fixture: 60, history: 300 };

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

function buildCacheKey(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/history") {
    const fixtureId = url.searchParams.get("fixture");
    if (fixtureId && /^\d+$/.test(fixtureId)) {
      const canonical = new URL(url.origin + url.pathname);
      canonical.searchParams.set("fixture", fixtureId);
      return new Request(canonical.toString(), { method: "GET" });
    }
  }
  return new Request(request.url, request);
}

async function withCache(request, ctx, ttlSeconds, computeFn) {
  if (request.method !== "GET" || !ttlSeconds) return computeFn();
  const cache = caches.default;
  const cacheKey = buildCacheKey(request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  let response = await computeFn();
  if (response.status === 200) {
    response = new Response(response.body, response);
    response.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  } else if (response.status === 429) {
    const shortTtl = 15;
    response = new Response(response.body, response);
    response.headers.set("Cache-Control", `public, max-age=${shortTtl}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

async function sports(url, env) {
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Data invalida. Use AAAA-MM-DD." }, 400);

  const preferred = String(url.searchParams.get("provider") || "auto").toLowerCase();
  const sources = {};
  let data = [];
  let providerMode = "none";
  let primaryRateLimited = false;

  const tryApiFootball = preferred === "auto" || preferred === "api-football";
  const tryFootballData = preferred === "auto" || preferred === "football-data";

  if (tryApiFootball && apiFootballConfigured(env)) {
    const result = await apiFootballSports(date, env);
    const rows = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
    const filtered = rows.filter(g => isAllowedLeague(g?.league || {}));
    const errors = result?.diagnostic?.errors ?? result?.errors ?? null;
    const rateLimited = Boolean(
      result?.rateLimited ||
      (errors && /rate\s*limit|too many requests/i.test(JSON.stringify(errors)))
    );
    sources.apiFootball = {
      configured: true,
      count: filtered.length,
      status: result?.diagnostic?.status ?? null,
      errors,
      rateLimited
    };
    if (rateLimited) primaryRateLimited = true;
    if (filtered.length) {
      data = filtered;
      providerMode = "api-football";
    }
  } else if (tryApiFootball) {
    sources.apiFootball = { configured: false };
  }

  if ((!data.length || primaryRateLimited) && tryFootballData && footballDataConfigured(env)) {
    const fd = await footballDataSports(date, env);
    sources.footballData = fd.diagnostic || { configured: true, count: (fd.data || []).length };
    if ((fd.data || []).length) {
      if (!data.length) {
        data = fd.data;
        providerMode = primaryRateLimited ? "football-data (fallback)" : "football-data";
      } else {
        const seen = new Set(data.map(g => String(g.id)));
        for (const g of fd.data) {
          if (!seen.has(String(g.id))) data.push(g);
        }
        providerMode = "api-football+football-data";
      }
    }
  } else if (tryFootballData) {
    sources.footballData = { configured: footballDataConfigured(env) };
  }

  if (!data.length) {
    const status = primaryRateLimited ? 429 : 404;
    return json({
      error: primaryRateLimited
        ? "Limite da API-Football atingido e nenhum jogo no provider de fallback para esta data."
        : "Nenhum jogo encontrado para esta data no catalogo Green Engine.",
      providerMode,
      sources
    }, status);
  }

  return json({
    providerMode,
    data,
    sources,
    meta: { total: data.length, date, timezone: "America/Sao_Paulo", leagueFilter: "curated", provider: providerMode }
  }, 200);
}

async function leagues(env) {
  if (!apiFootballConfigured(env)) return json({ error: "API_FOOTBALL_KEY nao esta configurada no Cloudflare." }, 500);
  const result = await apiFootballLeagues(env);
  const data = Array.isArray(result) ? result : [];
  return json({
    providerMode: "api-football",
    sources: { apiFootball: { configured: true, count: data.length, status: result?.diagnostic?.status ?? null, errors: result?.diagnostic?.errors ?? null } },
    data,
    availableLeagueCount: data.length,
    catalog: { type: "curated", genders: ["male", "female", "mixed"], priorities: ["A", "B"] }
  }, 200);
}

async function markets(env) {
  if (!apiFootballConfigured(env)) return json({ error: "API_FOOTBALL_KEY nao esta configurada no Cloudflare." }, 500);

  const result = await apiFootballBetTypes(env);
  return json({
    providerMode: "api-football",
    data: result?.data || [],
    availableBetTypeCount: result?.results || 0,
    source: "API-Football /odds/bets",
    diagnostic: result?.diagnostic || null,
    greenEngine: {
      implementedStatisticalFamilies: ["goals", "both-teams-to-score", "home-away-double-chance (+0.5)", "corners", "yellow-cards"],
      candidateStatisticalFamilies: ["shots", "offsides", "fouls", "red-cards", "possession", "passes"],
      eligibilityPipeline: ["API-Football bet catalogue", "fixture/league coverage", "historical observations", "market probability", "Confidence Score", "global ranking"],
      selectionRule: "probability + Confidence Score + global ranking",
      oddsInfluence: false,
      recommendationThresholds: { confidenceScoreMin: 70, probabilityMin: 0.70, scoreGapMin: 3 }
    }
  }, 200);
}

async function fixture(url, env) {
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return json({ error: "Informe um fixture ID numerico." }, 400);

  const context = {
    date: url.searchParams.get("date") || "",
    home: url.searchParams.get("home") || "",
    away: url.searchParams.get("away") || ""
  };
  const preferred = String(url.searchParams.get("provider") || "auto").toLowerCase();

  if ((preferred === "auto" || preferred === "api-football") && apiFootballConfigured(env)) {
    const data = await apiFootballFixture(id, env, context);
    if (data?.__rateLimited) {
      if (footballDataConfigured(env)) {
        const fd = await footballDataFixture(id, env, context);
        if (fd && !fd.__rateLimited) {
          return json({ provider: "football-data", data: fd, fallbackFrom: "api-football-rate-limit" }, 200);
        }
      }
      return json({
        error: "Limite de requisicoes da API-Football atingido.",
        rateLimited: true,
        diagnostic: data.diagnostic || null
      }, 429);
    }
    if (data) {
      if (!isAllowedLeague(data?.league || {})) {
        return json({ error: "A liga do fixture nao esta no catalogo Green Engine." }, 404);
      }
      return json({ provider: "api-football", data }, 200);
    }
  }

  if ((preferred === "auto" || preferred === "football-data") && footballDataConfigured(env)) {
    const fd = await footballDataFixture(id, env, context);
    if (fd?.__rateLimited) {
      return json({ error: "Limite de requisicoes do football-data.org atingido.", rateLimited: true }, 429);
    }
    if (fd) return json({ provider: "football-data", data: fd }, 200);
  }

  if (!apiFootballConfigured(env) && !footballDataConfigured(env)) {
    return json({ error: "Nenhuma chave de provider configurada (API_FOOTBALL_KEY / FOOTBALL_DATA_API_KEY)." }, 500);
  }

  return json({
    error: "Fixture nao encontrado nem pelo provider primario nem pelo fallback (envie date+home+away se o ID for de outra API).",
  }, 404);
}

async function history(url, env) {
  const fixtureId = url.searchParams.get("fixture");
  if (!fixtureId || !/^\d+$/.test(fixtureId)) return json({ error: "Informe um fixture ID numerico." }, 400);

  const context = {
    date: url.searchParams.get("date") || "",
    home: url.searchParams.get("home") || "",
    away: url.searchParams.get("away") || ""
  };
  const preferred = String(url.searchParams.get("provider") || "auto").toLowerCase();

  const tryPrimary = preferred === "auto" || preferred === "api-football";
  const tryFallback = preferred === "auto" || preferred === "football-data";

  if (tryPrimary && apiFootballConfigured(env)) {
    const result = await apiFootballHistory(fixtureId, env, context);
    if (result.statusCode === 200) {
      return json(result.body, 200);
    }
    const is429 = result.statusCode === 429 || /limite de requisicoes|rate\s*limit/i.test(String(result.body?.error || ""));
    if (is429 && tryFallback && footballDataConfigured(env)) {
      const fd = await footballDataHistory(fixtureId, env, context);
      if (fd.statusCode === 200) {
        fd.body.diagnostic = { ...(fd.body.diagnostic || {}), fallbackFrom: "api-football-rate-limit" };
        return json(fd.body, 200);
      }
      return json({
        ...(result.body || {}),
        fallback: { provider: "football-data", status: fd.statusCode, error: fd.body?.error }
      }, 429);
    }
    return json(result.body || { ok: false, error: "Falha no historico" }, result.statusCode || 500);
  }

  if (tryFallback && footballDataConfigured(env)) {
    const fd = await footballDataHistory(fixtureId, env, context);
    return json(fd.body, fd.statusCode);
  }

  return json({ error: "Nenhuma chave de provider configurada (API_FOOTBALL_KEY / FOOTBALL_DATA_API_KEY)." }, 500);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const incoming = new URL(request.url);
      if (incoming.hostname.includes("green-engine-v6-3-16-cf")) {
        const target = new URL(request.url);
        target.hostname = "green-engine-v6-3-15-cf.gerenteheliton.workers.dev";
        return Response.redirect(target.toString(), 302);
      }
    } catch (_) {}

    if (request.method === "OPTIONS") return cors(request, json({ ok: true }), env);
    const url = new URL(request.url);
    let response;
    if (url.pathname === "/api/sports") response = await withCache(request, ctx, CACHE_TTL.sports, () => sports(url, env));
    else if (url.pathname === "/api/leagues") response = await withCache(request, ctx, CACHE_TTL.leagues, () => leagues(env));
    else if (url.pathname === "/api/markets") response = await withCache(request, ctx, CACHE_TTL.markets, () => markets(env));
    else if (url.pathname === "/api/fixture") response = await withCache(request, ctx, CACHE_TTL.fixture, () => fixture(url, env));
    else if (url.pathname === "/api/history") response = await withCache(request, ctx, CACHE_TTL.history, () => history(url, env));
    else if (url.pathname === "/health") response = json({ ok: true, service: "green-engine-v6.3.16", timezone: "America/Sao_Paulo", leagueFilter: "curated", providers: { apiFootball: apiFootballConfigured(env), footballData: footballDataConfigured(env) }, providerMode: "auto-fallback" }, 200);
    else if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    } else {
      response = json({ error: "Rota nao encontrada." }, 404);
    }
    return cors(request, response, env);
  }
};
