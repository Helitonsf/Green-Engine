import { normalizeGreenScoreOutput, calculateGreenScore } from "../history-core.js";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const FETCH_TIMEOUT_MS = 10000;
/** last= por time — menor = menos pressão no plano free; 8 costuma bastar para 5 válidos. */
const HISTORY_CANDIDATES = 8;
const REQUIRED_HISTORY = 5;
/** IDs no lote fixtures?ids= (1 chamada). */
const MAX_DETAIL_FIXTURES = 10;
/** Máx. de /fixtures/statistics extras (as que mais estouram rate-limit). */
const MAX_STATS_FETCHES = 6;

async function apiFetch(path, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_FOOTBALL_BASE}${path}`, {
      headers: { "x-apisports-key": apiKey, Accept: "application/json" },
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === "AbortError" ? 504 : 502,
      data: { error: error?.message || String(error) }
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace("%", "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyStatistics(statistics) {
  const rows = Array.isArray(statistics) ? statistics : [];
  const map = {
    "corner kicks": "corners",
    "ball possession": "possession",
    "yellow cards": "yellowCards",
    "red cards": "redCards",
    "total shots": "totalShots",
    "shots on goal": "shotsOnTarget",
    "shots off goal": "shotsOffTarget",
    "blocked shots": "blockedShots",
    "fouls": "fouls",
    "offsides": "offsides"
  };

  return rows.flatMap(row => {
    const teamId = Number(row?.team?.id);
    const stats = Array.isArray(row?.statistics) ? row.statistics : [];
    if (!teamId) return [];
    return stats.map(stat => ({
      typeId: null,
      category: map[String(stat?.type || "").toLowerCase()] || "unclassified",
      participantId: teamId,
      location: null,
      value: toNumber(stat?.value)
    })).filter(stat => stat.value != null);
  });
}

function normalizeFixture(fixture, teamId) {
  const teams = fixture?.teams || {};
  const home = teams.home || null;
  const away = teams.away || null;
  const isHome = Number(home?.id) === Number(teamId);
  const homeGoals = toNumber(fixture?.goals?.home);
  const awayGoals = toNumber(fixture?.goals?.away);
  const scoreAvailable = homeGoals != null && awayGoals != null;
  const venue = isHome ? "home" : "away";

  const statistics = Array.isArray(fixture?.statistics) ? fixture.statistics : [];
  const statisticsNormalized = classifyStatistics(statistics).map(stat => ({
    ...stat,
    location:
      stat.participantId === Number(home?.id)
        ? "home"
        : stat.participantId === Number(away?.id)
          ? "away"
          : null
  }));

  return {
    id: Number(fixture?.fixture?.id),
    starting_at: fixture?.fixture?.date || null,
    name: `${home?.name || "Casa"} vs ${away?.name || "Fora"}`,
    venue,
    opponent: isHome ? away?.name || null : home?.name || null,
    result: scoreAvailable
      ? (isHome
          ? homeGoals > awayGoals ? "W" : homeGoals < awayGoals ? "L" : "D"
          : awayGoals > homeGoals ? "W" : awayGoals < homeGoals ? "L" : "D")
      : null,
    goalsFor: scoreAvailable ? (isHome ? homeGoals : awayGoals) : null,
    goalsAgainst: scoreAvailable ? (isHome ? awayGoals : homeGoals) : null,
    score: { home: homeGoals, away: awayGoals },
    statistics,
    statisticsNormalized,
    scoreSource: "goals.home-away",
    scoreAvailable
  };
}

function summarizeHistory(teamId, matches, venue) {
  const wins = matches.filter(match => match.result === "W").length;
  const draws = matches.filter(match => match.result === "D").length;
  const losses = matches.filter(match => match.result === "L").length;
  const goalsFor = matches.reduce((sum, match) => sum + Number(match.goalsFor || 0), 0);
  const goalsAgainst = matches.reduce((sum, match) => sum + Number(match.goalsAgainst || 0), 0);
  const sampleSize = matches.length;
  const avg = value => sampleSize ? value / sampleSize : 0;

  return {
    teamId: Number(teamId),
    sampleSize,
    matches,
    form: matches.map(match => match.result).join("") || null,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    avgGoalsFor: avg(goalsFor),
    avgGoalsAgainst: avg(goalsAgainst),
    avgTotalGoals: avg(goalsFor + goalsAgainst),
    _venueMatches: matches.filter(match => match.venue === venue).slice(0, REQUIRED_HISTORY),
    _requiredVenue: venue
  };
}

function isBeforeFixture(match, fixture) {
  const matchTime = new Date(match?.fixture?.date || 0).getTime();
  const fixtureTime = new Date(fixture?.fixture?.date || 0).getTime();
  const matchId = Number(match?.fixture?.id || 0);
  const fixtureId = Number(fixture?.fixture?.id || 0);
  return matchId !== fixtureId && (matchTime < fixtureTime || (matchTime === fixtureTime && matchId < fixtureId));
}

function extractFixtureFromResult(result) {
  if (!result) return null;
  const response = result.data?.response;
  if (Array.isArray(response) && response.length) return response[0];
  return null;
}

function hasApiErrors(result) {
  const errors = result?.data?.errors;
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "object") return Object.keys(errors).length > 0;
  return Boolean(errors);
}

/** Detecta rate-limit da API-Football (plano free estoura com facilidade). */
function isRateLimited(result) {
  if (!result) return false;
  if (result.status === 429) return true;
  const errors = result?.data?.errors;
  if (!errors) return false;
  const text = typeof errors === "string" ? errors : JSON.stringify(errors);
  return /rate\s*limit|too many requests|exceeded the limit/i.test(text);
}

/**
 * Resolve o fixture de forma robusta:
 * 1) /fixtures?id= (preferido)
 * 2) /fixtures?ids=
 * 3) busca por data + nomes (quando context informado) — mesmo fallback do /api/fixture
 *
 * Isso evita "Fixture nao encontrado" quando o plano free/rate-limit
 * devolve response vazio em /fixtures?id= mas o jogo existe via data.
 */
async function resolveFixture(id, env, context = {}) {
  const attempts = [];

  const byId = await apiFetch(`/fixtures?id=${encodeURIComponent(id)}`, env.API_FOOTBALL_KEY);
  attempts.push({ path: `/fixtures?id=${id}`, status: byId.status, errors: byId.data?.errors ?? null, count: Array.isArray(byId.data?.response) ? byId.data.response.length : 0 });
  // Rate-limit: não gastar mais chamadas de fallback.
  if (isRateLimited(byId)) return { fixture: null, attempts, lastResult: byId };
  let fixture = extractFixtureFromResult(byId);
  if (fixture) return { fixture, attempts };

  const byIds = await apiFetch(`/fixtures?ids=${encodeURIComponent(id)}`, env.API_FOOTBALL_KEY);
  attempts.push({ path: `/fixtures?ids=${id}`, status: byIds.status, errors: byIds.data?.errors ?? null, count: Array.isArray(byIds.data?.response) ? byIds.data.response.length : 0 });
  if (isRateLimited(byIds)) return { fixture: null, attempts, lastResult: byIds };
  fixture = extractFixtureFromResult(byIds);
  if (fixture) return { fixture, attempts };

  const date = String(context?.date || "").slice(0, 10);
  const homeName = context?.home;
  const awayName = context?.away;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && homeName && awayName) {
    const byDate = await apiFetch(
      `/fixtures?date=${encodeURIComponent(date)}&timezone=America/Sao_Paulo`,
      env.API_FOOTBALL_KEY
    );
    const candidates = Array.isArray(byDate.data?.response) ? byDate.data.response : [];
    attempts.push({ path: `/fixtures?date=${date}`, status: byDate.status, errors: byDate.data?.errors ?? null, count: candidates.length });
    if (isRateLimited(byDate)) return { fixture: null, attempts, lastResult: byDate };

    const normalize = value =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\b(fc|cf|afc|club|football|futbol|f\.?c\.?)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const same = (a, b) => {
      const left = normalize(a);
      const right = normalize(b);
      if (!left || !right) return false;
      return left === right || left.includes(right) || right.includes(left);
    };

    fixture = candidates.find(item => {
      const fixtureDate = String(item?.fixture?.date || "").slice(0, 10);
      return fixtureDate === date
        && same(item?.teams?.home?.name, homeName)
        && same(item?.teams?.away?.name, awayName);
    }) || null;

    if (fixture) return { fixture, attempts };
  }

  return { fixture: null, attempts, lastResult: byIds || byId };
}

export async function apiFootballHistory(id, env, context = {}) {
  if (!env.API_FOOTBALL_KEY) {
    return { statusCode: 500, body: { ok: false, provider: "api-football", error: "API_FOOTBALL_KEY nao esta configurada no Cloudflare." } };
  }

  const { fixture, attempts, lastResult } = await resolveFixture(id, env, context);

  if (!fixture) {
    const rateLimited = (attempts || []).some(a =>
      isRateLimited({ status: a.status, data: { errors: a.errors } })
    );
    return {
      statusCode: rateLimited ? 429 : (lastResult?.status || 404),
      body: {
        ok: false,
        provider: "api-football",
        error: rateLimited
          ? "Limite de requisicoes da API-Football atingido. Tente novamente em alguns segundos."
          : "Fixture API-Football nao encontrado.",
        diagnostic: {
          stage: "resolve-fixture",
          requestedId: String(id),
          context: {
            date: context?.date || null,
            home: context?.home || null,
            away: context?.away || null
          },
          attempts: attempts || [],
          errors: lastResult?.data?.errors ?? null
        }
      }
    };
  }

  const homeId = Number(fixture?.teams?.home?.id);
  const awayId = Number(fixture?.teams?.away?.id);
  if (!homeId || !awayId) {
    return { statusCode: 422, body: { ok: false, provider: "api-football", error: "Fixture sem equipes home/away." } };
  }

  const [homeCandidates, awayCandidates] = await Promise.all([
    apiFetch(`/fixtures?team=${homeId}&last=${HISTORY_CANDIDATES}&timezone=America/Sao_Paulo`, env.API_FOOTBALL_KEY),
    apiFetch(`/fixtures?team=${awayId}&last=${HISTORY_CANDIDATES}&timezone=America/Sao_Paulo`, env.API_FOOTBALL_KEY)
  ]);

  // Rate-limit no last= é comum no plano free; não mascarar como "histórico indisponível".
  if (isRateLimited(homeCandidates) || isRateLimited(awayCandidates)) {
    return {
      statusCode: 429,
      body: {
        ok: false,
        provider: "api-football",
        error: "Limite de requisicoes da API-Football atingido. Tente novamente em alguns segundos.",
        diagnostic: {
          stage: "team-last",
          homeStatus: homeCandidates?.status ?? null,
          awayStatus: awayCandidates?.status ?? null,
          homeErrors: homeCandidates?.data?.errors ?? null,
          awayErrors: awayCandidates?.data?.errors ?? null,
          homeCount: Array.isArray(homeCandidates.data?.response) ? homeCandidates.data.response.length : 0,
          awayCount: Array.isArray(awayCandidates.data?.response) ? awayCandidates.data.response.length : 0,
          requiredPerTeam: REQUIRED_HISTORY
        }
      }
    };
  }

  const candidates = [
    ...(Array.isArray(homeCandidates.data?.response) ? homeCandidates.data.response : []),
    ...(Array.isArray(awayCandidates.data?.response) ? awayCandidates.data.response : [])
  ].filter(item => isBeforeFixture(item, fixture));

  const ids = [...new Set(candidates.map(item => Number(item?.fixture?.id)).filter(Boolean))].slice(0, MAX_DETAIL_FIXTURES);
  if (!ids.length) {
    return {
      statusCode: 422,
      body: {
        ok: false,
        provider: "api-football",
        error: "Historico API-Football indisponivel antes do fixture.",
        diagnostic: {
          stage: "pre-fixture-filter",
          homeHistoryCount: 0,
          awayHistoryCount: 0,
          requiredPerTeam: REQUIRED_HISTORY,
          homeLastCount: Array.isArray(homeCandidates.data?.response) ? homeCandidates.data.response.length : 0,
          awayLastCount: Array.isArray(awayCandidates.data?.response) ? awayCandidates.data.response.length : 0,
          homeStatus: homeCandidates?.status ?? null,
          awayStatus: awayCandidates?.status ?? null,
          homeErrors: homeCandidates?.data?.errors ?? null,
          awayErrors: awayCandidates?.data?.errors ?? null
        }
      }
    };
  }

  // Detalhes em lote (ids=) para estatísticas; candidatos já trazem gols.
  const details = await apiFetch(`/fixtures?ids=${ids.join("-")}`, env.API_FOOTBALL_KEY);
  if (isRateLimited(details)) {
    return {
      statusCode: 429,
      body: {
        ok: false,
        provider: "api-football",
        error: "Limite de requisicoes da API-Football atingido. Tente novamente em alguns segundos.",
        diagnostic: {
          stage: "fixtures-ids-batch",
          status: details?.status ?? null,
          errors: details?.data?.errors ?? null,
          requestedIds: ids.length
        }
      }
    };
  }
  const detailedFixtures = Array.isArray(details.data?.response) ? details.data.response : [];
  const byId = new Map(detailedFixtures.map(item => [Number(item?.fixture?.id), item]));

  // Fallback: se o lote não retornar um fixture, reutilizar o candidato (gols ok; stats vazias).
  function resolveFixtureRow(item) {
    const fid = Number(item?.fixture?.id);
    return byId.get(fid) || item || null;
  }

  /**
   * Stats são best-effort: no plano free cada /fixtures/statistics conta 1 request.
   * - só busca o que ainda não veio no lote
   * - hard-cap MAX_STATS_FETCHES no total (home+away)
   * - para no primeiro rate-limit e segue com o que já tem (gols continuam válidos)
   */
  async function attachStatistics(homeList, awayList) {
    const homeOut = [...homeList];
    const awayOut = [...awayList];
    let remaining = MAX_STATS_FETCHES;
    let hitRateLimit = false;

    async function fill(list) {
      for (let i = 0; i < list.length; i++) {
        if (remaining <= 0 || hitRateLimit) break;
        const row = list[i];
        if (!row) continue;
        if (Array.isArray(row.statistics) && row.statistics.length) continue;
        const fid = Number(row?.fixture?.id);
        if (!fid) continue;
        remaining -= 1;
        const statsResult = await apiFetch(`/fixtures/statistics?fixture=${fid}`, env.API_FOOTBALL_KEY);
        if (isRateLimited(statsResult)) {
          hitRateLimit = true;
          break;
        }
        const stats = Array.isArray(statsResult.data?.response) ? statsResult.data.response : [];
        if (stats.length) list[i] = { ...row, statistics: stats };
      }
    }

    // Home primeiro (mais recente), depois away — prioriza amostra principal.
    await fill(homeOut);
    await fill(awayOut);
    return { home: homeOut, away: awayOut, statsFetchesUsed: MAX_STATS_FETCHES - remaining, statsRateLimited: hitRateLimit };
  }

  let homeRows = candidates
    .filter(item => Number(item?.teams?.home?.id) === homeId || Number(item?.teams?.away?.id) === homeId)
    .map(resolveFixtureRow)
    .filter(Boolean)
    .sort((a, b) => new Date(b?.fixture?.date || 0) - new Date(a?.fixture?.date || 0))
    .slice(0, REQUIRED_HISTORY);

  let awayRows = candidates
    .filter(item => Number(item?.teams?.home?.id) === awayId || Number(item?.teams?.away?.id) === awayId)
    .map(resolveFixtureRow)
    .filter(Boolean)
    .sort((a, b) => new Date(b?.fixture?.date || 0) - new Date(a?.fixture?.date || 0))
    .slice(0, REQUIRED_HISTORY);

  const statsAttach = await attachStatistics(homeRows, awayRows);
  homeRows = statsAttach.home;
  awayRows = statsAttach.away;

  const homeMatches = homeRows
    .map(item => normalizeFixture(item, homeId))
    .filter(match => match.scoreAvailable);

  const awayMatches = awayRows
    .map(item => normalizeFixture(item, awayId))
    .filter(match => match.scoreAvailable);

  if (homeMatches.length < REQUIRED_HISTORY || awayMatches.length < REQUIRED_HISTORY) {
    return {
      statusCode: 422,
      body: {
        ok: false,
        provider: "api-football",
        error: "Historico insuficiente com placares validos para a amostra solicitada.",
        diagnostic: {
          fixtureRequestOk: true,
          currentFixtureExcluded: true,
          homeHistoryCount: homeMatches.length,
          awayHistoryCount: awayMatches.length,
          requiredPerTeam: REQUIRED_HISTORY
        }
      }
    };
  }

  const homeHistory = summarizeHistory(homeId, homeMatches, "home");
  const awayHistory = summarizeHistory(awayId, awayMatches, "away");
  const homeVenueMatches = homeMatches.filter(match => match.venue === "home").slice(0, REQUIRED_HISTORY);
  const awayVenueMatches = awayMatches.filter(match => match.venue === "away").slice(0, REQUIRED_HISTORY);
  const greenScore = normalizeGreenScoreOutput(calculateGreenScore(
    homeHistory,
    awayHistory,
    homeVenueMatches,
    awayVenueMatches
  ));

  return {
    statusCode: 200,
    body: {
      ok: true,
      version: "6.3.16",
      provider: "api-football",
      fixture: {
        id: Number(fixture.fixture.id),
        name: `${fixture.teams.home.name} vs ${fixture.teams.away.name}`,
        starting_at: fixture.fixture.date || null,
        league: fixture.league?.name || null,
        state: fixture.fixture?.status?.long || null,
        home: { id: homeId, name: fixture.teams.home.name },
        away: { id: awayId, name: fixture.teams.away.name }
      },
      history: {
        home: homeHistory,
        away: awayHistory
      },
      greenScore,
      diagnostic: {
        fixtureRequestOk: true,
        currentFixtureExcluded: true,
        homeHistoryCount: homeMatches.length,
        awayHistoryCount: awayMatches.length,
        homeVenueCount: homeVenueMatches.length,
        awayVenueCount: awayVenueMatches.length,
        homeVenueCorrect: homeVenueMatches.every(match => match.venue === "home"),
        awayVenueCorrect: awayVenueMatches.every(match => match.venue === "away"),
        allHistoryBeforeFixture: [...homeMatches, ...awayMatches].every(match => new Date(match.starting_at).getTime() < new Date(fixture.fixture.date).getTime()),
        statsFetchesUsed: statsAttach.statsFetchesUsed,
        statsRateLimited: statsAttach.statsRateLimited,
        maxStatsFetches: MAX_STATS_FETCHES
      }
    }
  };
}
