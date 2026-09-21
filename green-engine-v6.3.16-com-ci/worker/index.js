import { apiFootballConfigured, apiFootballLeagues, apiFootballBetTypes, apiFootballSports, apiFootballFixture } from "../cloudflare/providers/api-football.js";
import { apiFootballHistory } from "../cloudflare/providers/api-football-history.js";
import { isAllowedLeague } from "../cloudflare/providers/league-catalog.js";
import { footballDataConfigured, footballDataSports, footballDataFixture } from "../cloudflare/providers/football-data.js";
import { footballDataHistory } from "../cloudflare/providers/football-data-history.js";
import { apiFootballOdds, enrichMarketsWithOdds } from "../cloudflare/providers/api-football-odds.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const CACHE_TTL = { sports: 120, leagues: 3600, markets: 86400, fixture: 60, history: 300 };

/** Statuses de partida já encerrada (não listar como pré-jogo). */
const FINISHED_SHORT = new Set([
  "FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO", "FINISHED", "MATCH FINISHED"
]);
const FINISHED_LONG = new Set([
  "MATCH FINISHED", "FINISHED", "AFTER EXTRA TIME", "AFTER PENALTIES",
  "POSTPONED", "CANCELLED", "ABANDONED", "TECHNICAL LOSS", "WALKOVER"
]);

function isFixtureFinished(game) {
  if (!game) return false;
  const status = game.status || {};
  const short = String(status.short || status.long || game.state || "").trim().toUpperCase();
  const long = String(status.long || game.state || "").trim().toUpperCase();
  if (FINISHED_SHORT.has(short) || FINISHED_LONG.has(long) || FINISHED_SHORT.has(long)) return true;
  if (["FINISHED", "AWARDED", "CANCELLED", "POSTPONED"].includes(short)) return true;
  return false;
}

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
  let apiFootballRateLimited = false;

  const tryFootballData = preferred === "auto" || preferred === "football-data";
  const tryApiFootball = preferred === "auto" || preferred === "api-football";

  if (tryFootballData && footballDataConfigured(env)) {
    const fd = await footballDataSports(date, env);
    sources.footballData = fd.diagnostic || {
      configured: true,
      count: (fd.data || []).length,
      rateLimited: Boolean(fd.rateLimited)
    };
    if ((fd.data || []).length) {
      data = fd.data.slice();
      providerMode = "football-data";
    }
  } else if (tryFootballData) {
    sources.footballData = { configured: false };
  }

  const shouldCallApiFootball =
    tryApiFootball &&
    apiFootballConfigured(env) &&
    (preferred === "api-football" || !data.length || preferred === "auto");

  if (shouldCallApiFootball) {
    const callAf = preferred === "api-football" || !data.length;
    if (callAf) {
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
      if (rateLimited) apiFootballRateLimited = true;
      if (filtered.length && !data.length) {
        data = filtered;
        providerMode = "api-football (fallback)";
      }
    } else {
      sources.apiFootball = { configured: true, skipped: true, reason: "football-data-primary-has-data" };
    }
  } else if (tryApiFootball) {
    sources.apiFootball = { configured: apiFootballConfigured(env) };
  }

  const includeFinished = ["1", "true", "yes"].includes(String(url.searchParams.get("includeFinished") || "").toLowerCase());
  const beforeFilter = data.length;
  if (!includeFinished) {
    data = data.filter(g => !isFixtureFinished(g));
  }

  if (!data.length) {
    const status = apiFootballRateLimited ? 429 : 404;
    return json({
      error: apiFootballRateLimited
        ? "football-data sem jogos pendentes e API-Football no limite nesta data."
        : (beforeFilter > 0
          ? "Nenhum jogo pendente/ao vivo nesta data (apenas partidas já encerradas foram encontradas)."
          : "Nenhum jogo encontrado para esta data (football-data 12 ligas free; API-Football indisponivel ou vazia)."),
      providerMode,
      sources,
      meta: { total: 0, beforeFilter, excludedFinished: !includeFinished, date, priority: "football-data-first" }
    }, status);
  }

  return json({
    providerMode,
    data,
    sources,
    meta: {
      total: data.length,
      beforeFilter,
      excludedFinished: !includeFinished,
      date,
      timezone: "America/Sao_Paulo",
      leagueFilter: "curated",
      provider: providerMode,
      priority: "football-data-first"
    }
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

  if ((preferred === "auto" || preferred === "football-data") && footballDataConfigured(env)) {
    const fd = await footballDataFixture(id, env, context);
    if (fd?.__rateLimited) {
      if (preferred === "football-data") {
        return json({ error: "Limite de requisicoes do football-data.org atingido.", rateLimited: true }, 429);
      }
    } else if (fd) {
      return json({ provider: "football-data", data: fd }, 200);
    }
  }

  if ((preferred === "auto" || preferred === "api-football") && apiFootballConfigured(env)) {
    const data = await apiFootballFixture(id, env, context);
    if (data?.__rateLimited) {
      return json({
        error: "API-Football no limite e football-data nao resolveu o fixture.",
        rateLimited: true,
        diagnostic: data.diagnostic || null
      }, 429);
    }
    if (data) {
      if (!isAllowedLeague(data?.league || {})) {
        return json({ error: "A liga do fixture nao esta no catalogo Green Engine." }, 404);
      }
      return json({
        provider: "api-football",
        data,
        fallbackFrom: preferred === "auto" ? "football-data-miss" : null
      }, 200);
    }
  }

  if (!apiFootballConfigured(env) && !footballDataConfigured(env)) {
    return json({ error: "Nenhuma chave de provider configurada (FOOTBALL_DATA_API_KEY / API_FOOTBALL_KEY)." }, 500);
  }

  return json({
    error: "Fixture nao encontrado (football-data primeiro; API-Football como reserva). Envie date+home+away se o ID for de outra API.",
  }, 404);
}

async function attachOddsIfPossible(body, env) {
  try {
    if (!body?.ok || !body?.greenScore || !apiFootballConfigured(env)) return body;
    const fixtureId = body?.fixture?.id;
    if (!fixtureId) return body;
    const oddsResult = await apiFootballOdds(fixtureId, env);
    if (oddsResult.rateLimited) {
      body.diagnostic = { ...(body.diagnostic || {}), oddsRateLimited: true };
      return body;
    }
    if (!oddsResult.ok || !oddsResult.odds) {
      body.diagnostic = { ...(body.diagnostic || {}), oddsStatus: oddsResult.error || "unavailable" };
      return body;
    }
    const { greenScore, oddsAttached, matched } = enrichMarketsWithOdds(body.greenScore, oddsResult.odds);
    body.greenScore = greenScore;
    body.diagnostic = {
      ...(body.diagnostic || {}),
      oddsAttached,
      oddsMatched: matched,
      oddsBookmaker: oddsResult.odds.bookmaker?.name || null
    };
  } catch (e) {
    body.diagnostic = { ...(body.diagnostic || {}), oddsError: String(e?.message || e) };
  }
  return body;
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

  const tryFd = preferred === "auto" || preferred === "football-data";
  const tryAf = preferred === "auto" || preferred === "api-football";

  if (tryFd && footballDataConfigured(env)) {
    const fd = await footballDataHistory(fixtureId, env, context);
    if (fd.statusCode === 200) {
      const body = await attachOddsIfPossible(fd.body, env);
      body.diagnostic = { ...(body.diagnostic || {}), priority: "football-data-first" };
      return json(body, 200);
    }
    if (preferred === "football-data") {
      return json(fd.body || { ok: false, error: "Falha no historico football-data" }, fd.statusCode || 500);
    }
    if (tryAf && apiFootballConfigured(env)) {
      const result = await apiFootballHistory(fixtureId, env, context);
      if (result.statusCode === 200) {
        const body = await attachOddsIfPossible(result.body, env);
        body.diagnostic = {
          ...(body.diagnostic || {}),
          priority: "football-data-first",
          fallbackFrom: "football-data-miss",
          footballDataError: fd.body?.error || null
        };
        return json(body, 200);
      }
      return json({
        ok: false,
        error: result.body?.error || fd.body?.error || "Historico indisponivel nos dois providers.",
        diagnostic: {
          footballData: { status: fd.statusCode, error: fd.body?.error },
          apiFootball: { status: result.statusCode, error: result.body?.error }
        }
      }, result.statusCode === 429 || fd.statusCode === 429 ? 429 : (result.statusCode || fd.statusCode || 500));
    }
    return json(fd.body || { ok: false, error: "Falha no historico" }, fd.statusCode || 500);
  }

  if (tryAf && apiFootballConfigured(env)) {
    const result = await apiFootballHistory(fixtureId, env, context);
    if (result.statusCode === 200) {
      const body = await attachOddsIfPossible(result.body, env);
      return json(body, 200);
    }
    return json(result.body || { ok: false, error: "Falha no historico" }, result.statusCode || 500);
  }

  return json({ error: "Nenhuma chave de provider configurada (FOOTBALL_DATA_API_KEY / API_FOOTBALL_KEY)." }, 500);
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
    else if (url.pathname === "/health") response = json({ ok: true, service: "green-engine-v6.3.16", timezone: "America/Sao_Paulo", leagueFilter: "curated", providers: { apiFootball: apiFootballConfigured(env), footballData: footballDataConfigured(env) }, providerMode: "football-data-first", priority: "football-data → api-football", odds: "api-football-/odds (best-effort)" }, 200);
    else if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    } else {
      response = json({ error: "Rota nao encontrada." }, 404);
    }
    return cors(request, response, env);
  }
};
