/**
 * Green Engine worker — football-data.org only (API-Football removed).
 * Odds desativadas nesta versão.
 */
import { footballDataConfigured, footballDataSports, footballDataFixture } from "../cloudflare/providers/football-data.js";
import { footballDataHistory } from "../cloudflare/providers/football-data-history.js";

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", ...extraHeaders }
  });
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
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
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
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Data invalida. Use AAAA-MM-DD." }, 400);
  }

  if (!footballDataConfigured(env)) {
    return json({
      error: "FOOTBALL_DATA_API_KEY nao esta configurada no Cloudflare.",
      providerMode: "none",
      sources: { footballData: { configured: false } }
    }, 500);
  }

  const fd = await footballDataSports(date, env);
  const sources = {
    footballData: fd.diagnostic || {
      configured: true,
      count: (fd.data || []).length,
      rateLimited: Boolean(fd.rateLimited)
    }
  };

  let data = Array.isArray(fd.data) ? fd.data.slice() : [];
  const includeFinished = ["1", "true", "yes"].includes(
    String(url.searchParams.get("includeFinished") || "").toLowerCase()
  );
  const beforeFilter = data.length;
  if (!includeFinished) {
    data = data.filter(g => !isFixtureFinished(g));
  }

  if (fd.rateLimited) {
    return json({
      error: "Limite de requisicoes do football-data.org atingido. Aguarde e tente de novo.",
      providerMode: "football-data",
      sources,
      meta: { total: 0, beforeFilter, excludedFinished: !includeFinished, date }
    }, 429);
  }

  if (!data.length) {
    return json({
      error: beforeFilter > 0
        ? "Nenhum jogo pendente/ao vivo nesta data (apenas partidas ja encerradas)."
        : "Nenhum jogo encontrado para esta data nas 12 ligas free do football-data.org (PL, PD, BL1, SA, FL1, DED, PPL, ELC, BSA, CL, WC, EC).",
      providerMode: "football-data",
      sources,
      meta: { total: 0, beforeFilter, excludedFinished: !includeFinished, date, leagues: "free-12" }
    }, 404);
  }

  return json({
    providerMode: "football-data",
    data,
    sources,
    meta: {
      total: data.length,
      beforeFilter,
      excludedFinished: !includeFinished,
      date,
      timezone: "America/Sao_Paulo",
      leagueFilter: "football-data-free-12",
      provider: "football-data"
    }
  }, 200);
}

async function leagues(env) {
  const data = [
    { code: "PL", name: "Premier League", country: "England" },
    { code: "PD", name: "La Liga", country: "Spain" },
    { code: "BL1", name: "Bundesliga", country: "Germany" },
    { code: "SA", name: "Serie A", country: "Italy" },
    { code: "FL1", name: "Ligue 1", country: "France" },
    { code: "DED", name: "Eredivisie", country: "Netherlands" },
    { code: "PPL", name: "Primeira Liga", country: "Portugal" },
    { code: "ELC", name: "Championship", country: "England" },
    { code: "BSA", name: "Brasileirão Série A", country: "Brazil" },
    { code: "CL", name: "UEFA Champions League", country: "Europe" },
    { code: "WC", name: "FIFA World Cup", country: "World" },
    { code: "EC", name: "European Championship", country: "Europe" }
  ];
  return json({
    providerMode: "football-data",
    data,
    availableLeagueCount: data.length,
    catalog: { type: "football-data-free", note: "Plano free: 12 competições" }
  }, 200);
}

async function markets(_env) {
  return json({
    providerMode: "football-data",
    data: [],
    availableBetTypeCount: 0,
    source: "none",
    note: "Odds e catalogo de apostas desativados (API-Football removida).",
    greenEngine: {
      implementedStatisticalFamilies: [
        "goals",
        "both-teams-to-score",
        "home-away-double-chance (+0.5)"
      ],
      candidateStatisticalFamilies: ["corners", "yellow-cards", "shots"],
      oddsInfluence: false,
      recommendationThresholds: {
        confidenceScoreMin: 70,
        probabilityMin: 0.7,
        scoreGapMin: 3
      }
    }
  }, 200);
}

async function fixture(url, env) {
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return json({ error: "Informe um fixture ID numerico." }, 400);
  }

  if (!footballDataConfigured(env)) {
    return json({ error: "FOOTBALL_DATA_API_KEY nao esta configurada no Cloudflare." }, 500);
  }

  const context = {
    date: url.searchParams.get("date") || "",
    home: url.searchParams.get("home") || "",
    away: url.searchParams.get("away") || ""
  };

  const fd = await footballDataFixture(id, env, context);
  if (fd?.__rateLimited) {
    return json({
      error: "Limite de requisicoes do football-data.org atingido.",
      rateLimited: true,
      diagnostic: { stage: fd.stage || "fixture" }
    }, 429);
  }
  if (fd) {
    return json({ provider: "football-data", data: fd }, 200);
  }

  return json({
    error:
      "Fixture nao encontrado no football-data.org. Use ID de uma das 12 ligas free ou envie date+home+away.",
    diagnostic: { requestedId: id, context }
  }, 404);
}

async function history(url, env) {
  const fixtureId = url.searchParams.get("fixture");
  if (!fixtureId || !/^\d+$/.test(fixtureId)) {
    return json({ error: "Informe um fixture ID numerico." }, 400);
  }

  if (!footballDataConfigured(env)) {
    return json({ error: "FOOTBALL_DATA_API_KEY nao esta configurada no Cloudflare." }, 500);
  }

  const context = {
    date: url.searchParams.get("date") || "",
    home: url.searchParams.get("home") || "",
    away: url.searchParams.get("away") || ""
  };

  const result = await footballDataHistory(fixtureId, env, context);
  const body = result.body || { ok: false, error: "Falha no historico" };
  if (body.greenScore) {
    body.greenScore = {
      ...body.greenScore,
      oddsInfluence: false,
      oddsSource: null
    };
  }
  body.diagnostic = {
    ...(body.diagnostic || {}),
    provider: "football-data",
    odds: "disabled",
    apiFootball: "removed"
  };
  return json(body, result.statusCode || 500);
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

    if (url.pathname === "/api/sports") {
      response = await withCache(request, ctx, CACHE_TTL.sports, () => sports(url, env));
    } else if (url.pathname === "/api/leagues") {
      response = await withCache(request, ctx, CACHE_TTL.leagues, () => leagues(env));
    } else if (url.pathname === "/api/markets") {
      response = await withCache(request, ctx, CACHE_TTL.markets, () => markets(env));
    } else if (url.pathname === "/api/fixture") {
      response = await withCache(request, ctx, CACHE_TTL.fixture, () => fixture(url, env));
    } else if (url.pathname === "/api/history") {
      response = await withCache(request, ctx, CACHE_TTL.history, () => history(url, env));
    } else if (url.pathname === "/health") {
      response = json({
        ok: true,
        service: "green-engine-v6.3.16",
        timezone: "America/Sao_Paulo",
        leagueFilter: "football-data-free-12",
        providers: {
          footballData: footballDataConfigured(env),
          apiFootball: false
        },
        providerMode: "football-data-only",
        priority: "football-data",
        odds: "disabled",
        note: "API-Football removida do projeto (rate-limit free)."
      }, 200);
    } else if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    } else {
      response = json({ error: "Rota nao encontrada." }, 404);
    }

    return cors(request, response, env);
  }
};
