/**
 * Histórico + Green Score a partir de football-data.org (fallback).
 * Usa apenas placares (sem stats detalhadas) — suficiente para o motor poisson+empirical.
 */

import { normalizeGreenScoreOutput, calculateGreenScore } from "../history-core.js";
import {
  footballDataConfigured,
  footballDataFixture,
  footballDataTeamMatches,
  namesLooselyMatch
} from "./football-data.js";

const REQUIRED_HISTORY = 5;
const HISTORY_CANDIDATES = 10;

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeFinishedMatch(raw, teamId) {
  const home = raw?.homeTeam || {};
  const away = raw?.awayTeam || {};
  const homeGoals = toNumber(raw?.score?.fullTime?.home ?? raw?.score?.regularTime?.home);
  const awayGoals = toNumber(raw?.score?.fullTime?.away ?? raw?.score?.regularTime?.away);
  const scoreAvailable = homeGoals != null && awayGoals != null;
  const isHome = Number(home?.id) === Number(teamId);
  const venue = isHome ? "home" : "away";
  return {
    id: Number(raw?.id),
    starting_at: raw?.utcDate || null,
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
    statisticsNormalized: []
  };
}

function summarizeHistory(teamId, matches, side) {
  const scored = matches.filter(m => m.goalsFor != null && m.goalsAgainst != null);
  const sampleSize = scored.length;
  const wins = scored.filter(m => m.result === "W").length;
  const draws = scored.filter(m => m.result === "D").length;
  const losses = scored.filter(m => m.result === "L").length;
  const goalsForAvg = sampleSize ? scored.reduce((s, m) => s + m.goalsFor, 0) / sampleSize : null;
  const goalsAgainstAvg = sampleSize ? scored.reduce((s, m) => s + m.goalsAgainst, 0) / sampleSize : null;
  return {
    teamId: Number(teamId),
    side,
    sampleSize,
    wins,
    draws,
    losses,
    goalsForAvg,
    goalsAgainstAvg,
    matches: scored
  };
}

/**
 * @returns {{ statusCode: number, body: object }}
 */
export async function footballDataHistory(fixtureId, env, context = {}) {
  if (!footballDataConfigured(env)) {
    return {
      statusCode: 500,
      body: { ok: false, provider: "football-data", error: "FOOTBALL_DATA_API_KEY nao configurada." }
    };
  }

  const resolved = await footballDataFixture(fixtureId, env, context);
  if (resolved?.__rateLimited) {
    return {
      statusCode: 429,
      body: {
        ok: false,
        provider: "football-data",
        error: "Limite de requisicoes do football-data.org atingido.",
        diagnostic: { stage: resolved.stage }
      }
    };
  }
  if (!resolved?.id || !resolved?.home?.id || !resolved?.away?.id) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        provider: "football-data",
        error: "football-data.org nao encontrou o fixture (use date+home+away no contexto se o ID for de outra API).",
        diagnostic: { requestedId: fixtureId, context }
      }
    };
  }

  const homeId = resolved.home.id;
  const awayId = resolved.away.id;
  const fixtureAt = resolved.starting_at ? new Date(resolved.starting_at).getTime() : Date.now();

  const [homeFetch, awayFetch] = await Promise.all([
    footballDataTeamMatches(homeId, env, { limit: HISTORY_CANDIDATES, status: "FINISHED" }),
    footballDataTeamMatches(awayId, env, { limit: HISTORY_CANDIDATES, status: "FINISHED" })
  ]);

  if (homeFetch.rateLimited || awayFetch.rateLimited) {
    return {
      statusCode: 429,
      body: {
        ok: false,
        provider: "football-data",
        error: "Limite de requisicoes do football-data.org atingido no historico.",
        diagnostic: { stage: "team-matches" }
      }
    };
  }

  const homeMatches = homeFetch.matches
    .map(m => normalizeFinishedMatch(m, homeId))
    .filter(m => m.goalsFor != null && m.id !== Number(resolved.id))
    .filter(m => !m.starting_at || new Date(m.starting_at).getTime() < fixtureAt)
    .slice(0, REQUIRED_HISTORY);

  const awayMatches = awayFetch.matches
    .map(m => normalizeFinishedMatch(m, awayId))
    .filter(m => m.goalsFor != null && m.id !== Number(resolved.id))
    .filter(m => !m.starting_at || new Date(m.starting_at).getTime() < fixtureAt)
    .slice(0, REQUIRED_HISTORY);

  if (homeMatches.length < REQUIRED_HISTORY || awayMatches.length < REQUIRED_HISTORY) {
    return {
      statusCode: 422,
      body: {
        ok: false,
        provider: "football-data",
        error: "Historico insuficiente no football-data.org para a amostra solicitada.",
        diagnostic: {
          homeHistoryCount: homeMatches.length,
          awayHistoryCount: awayMatches.length,
          requiredPerTeam: REQUIRED_HISTORY
        }
      }
    };
  }

  const homeHistory = summarizeHistory(homeId, homeMatches, "home");
  const awayHistory = summarizeHistory(awayId, awayMatches, "away");
  const homeVenueMatches = homeMatches.filter(m => m.venue === "home").slice(0, REQUIRED_HISTORY);
  const awayVenueMatches = awayMatches.filter(m => m.venue === "away").slice(0, REQUIRED_HISTORY);
  const greenScore = normalizeGreenScoreOutput(
    calculateGreenScore(homeHistory, awayHistory, homeVenueMatches, awayVenueMatches)
  );

  return {
    statusCode: 200,
    body: {
      ok: true,
      version: "6.3.16",
      provider: "football-data",
      fixture: {
        id: Number(resolved.id),
        name: resolved.name,
        starting_at: resolved.starting_at,
        league: resolved.league?.name || null,
        state: resolved.state,
        home: { id: homeId, name: resolved.home.name },
        away: { id: awayId, name: resolved.away.name }
      },
      history: { home: homeHistory, away: awayHistory },
      greenScore,
      diagnostic: {
        fixtureRequestOk: true,
        fallbackProvider: "football-data",
        homeHistoryCount: homeMatches.length,
        awayHistoryCount: awayMatches.length,
        homeVenueCount: homeVenueMatches.length,
        awayVenueCount: awayVenueMatches.length,
        statsFetchesUsed: 0,
        note: "Fallback free: placares apenas (sem stats de canto/finalizacao)"
      }
    }
  };
}
