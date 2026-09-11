import { normalizeGreenScoreOutput, calculateGreenScore } from "../history-core.js";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const FETCH_TIMEOUT_MS = 10000;
const HISTORY_CANDIDATES = 15;
const REQUIRED_HISTORY = 5;
const MAX_DETAIL_FIXTURES = 20;

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
    name: `${home?.name || "Casa"} — ${away?.name || "Fora"}`,
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

export async function apiFootballHistory(id, env) {
  if (!env.API_FOOTBALL_KEY) {
    return { statusCode: 500, body: { ok: false, provider: "api-football", error: "API_FOOTBALL_KEY nao esta configurada no Cloudflare." } };
  }

  const fixtureResult = await apiFetch(`/fixtures?ids=${encodeURIComponent(id)}`, env.API_FOOTBALL_KEY);
  const fixture = fixtureResult.data?.response?.[0];
  if (!fixtureResult.ok || !fixture) {
    return { statusCode: fixtureResult.status || 404, body: { ok: false, provider: "api-football", error: "Fixture API-Football nao encontrado." } };
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

  const candidates = [
    ...(Array.isArray(homeCandidates.data?.response) ? homeCandidates.data.response : []),
    ...(Array.isArray(awayCandidates.data?.response) ? awayCandidates.data.response : [])
  ].filter(item => isBeforeFixture(item, fixture));

  const ids = [...new Set(candidates.map(item => Number(item?.fixture?.id)).filter(Boolean))].slice(0, MAX_DETAIL_FIXTURES);
  if (!ids.length) {
    return { statusCode: 422, body: { ok: false, provider: "api-football", error: "Historico API-Football indisponivel antes do fixture.", diagnostic: { homeHistoryCount: 0, awayHistoryCount: 0, requiredPerTeam: REQUIRED_HISTORY } } };
  }

  const details = await apiFetch(`/fixtures?ids=${ids.join("-")}`, env.API_FOOTBALL_KEY);
  const detailedFixtures = Array.isArray(details.data?.response) ? details.data.response : [];
  const byId = new Map(detailedFixtures.map(item => [Number(item?.fixture?.id), item]));

  const homeMatches = candidates
    .filter(item => Number(item?.teams?.home?.id) === homeId || Number(item?.teams?.away?.id) === homeId)
    .map(item => byId.get(Number(item.fixture.id)))
    .filter(Boolean)
    .map(item => normalizeFixture(item, homeId))
    .filter(match => match.scoreAvailable)
    .sort((a, b) => new Date(b.starting_at) - new Date(a.starting_at))
    .slice(0, REQUIRED_HISTORY);

  const awayMatches = candidates
    .filter(item => Number(item?.teams?.home?.id) === awayId || Number(item?.teams?.away?.id) === awayId)
    .map(item => byId.get(Number(item.fixture.id)))
    .filter(Boolean)
    .map(item => normalizeFixture(item, awayId))
    .filter(match => match.scoreAvailable)
    .sort((a, b) => new Date(b.starting_at) - new Date(a.starting_at))
    .slice(0, REQUIRED_HISTORY);

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
        name: `${fixture.teams.home.name} — ${fixture.teams.away.name}`,
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
        allHistoryBeforeFixture: [...homeMatches, ...awayMatches].every(match => new Date(match.starting_at).getTime() < new Date(fixture.fixture.date).getTime())
      }
    }
  };
}
