import { enrichLeague, isAllowedLeague } from "./league-catalog.js";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const FETCH_TIMEOUT_MS = 10000;

function normalizeFixture(fixture) {
  const teams = fixture?.teams || {};
  const league = fixture?.league || {};
  const leagueMeta = enrichLeague({
    id: league.id,
    name: league.name,
    country: league.country
  });
  return {
    provider: "api-football",
    id: fixture?.fixture?.id ?? null,
    fixture_id: fixture?.fixture?.id ?? null,
    date: fixture?.fixture?.date ?? null,
    starting_at: fixture?.fixture?.date ?? null,
    timestamp: fixture?.fixture?.timestamp ?? null,
    timezone: fixture?.fixture?.timezone ?? null,
    status: fixture?.fixture?.status ?? null,
    state: fixture?.fixture?.status?.long ?? null,
    name: teams.home?.name && teams.away?.name ? `${teams.home.name} vs ${teams.away.name}` : null,
    home: teams.home ? { id: teams.home.id, name: teams.home.name } : null,
    away: teams.away ? { id: teams.away.id, name: teams.away.name } : null,
    participants: [
      teams.home ? { id: teams.home.id, name: teams.home.name, meta: { location: "home" } } : null,
      teams.away ? { id: teams.away.id, name: teams.away.name, meta: { location: "away" } } : null
    ].filter(Boolean),
    league: league.id ? {
      id: league.id,
      name: league.name,
      country: league.country || null,
      season: league.season ?? null,
      round: league.round || null,
      gender: leagueMeta.gender,
      priority: leagueMeta.priority,
      enabled: leagueMeta.enabled
    } : null,
    source: fixture
  };
}

async function apiFetch(path, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_FOOTBALL_BASE}${path}`, {
      headers: {
        "x-apisports-key": apiKey,
        "Accept": "application/json"
      },
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

function providerDiagnostic(result) {
  return {
    status: result?.status ?? null,
    errors: result?.data?.errors && typeof result.data.errors === "object" ? result.data.errors : null
  };
}

export function apiFootballConfigured(env) {
  return Boolean(env.API_FOOTBALL_KEY);
}

export async function apiFootballLeagues(env) {
  if (!env.API_FOOTBALL_KEY) {
    const data = [];
    data.diagnostic = { status: null, errors: { configuration: "API_FOOTBALL_KEY ausente" } };
    return data;
  }
  const result = await apiFetch("/leagues?current=true", env.API_FOOTBALL_KEY);
  const data = result.ok && Array.isArray(result.data?.response)
    ? result.data.response.map(item => ({
        provider: "api-football",
        id: item?.league?.id ?? null,
        name: item?.league?.name ?? "Liga sem nome",
        shortCode: item?.league?.code ?? null,
        active: true,
        type: item?.league?.type ?? null,
        subType: null,
        countryId: item?.country?.code ?? item?.country?.name ?? null,
        countryName: item?.country?.name ?? null,
        currentSeasonId: item?.seasons?.find(season => season?.current)?.year ?? null,
        coverage: item?.seasons?.find(season => season?.current)?.coverage ?? null
      })).filter(item => isAllowedLeague(item))
        .map(enrichLeague)
    : [];
  data.diagnostic = providerDiagnostic(result);
  return data;
}

export async function apiFootballBetTypes(env) {
  if (!env.API_FOOTBALL_KEY) {
    return {
      provider: "api-football",
      results: 0,
      data: [],
      diagnostic: { status: null, errors: { configuration: "API_FOOTBALL_KEY ausente" } }
    };
  }

  const result = await apiFetch("/odds/bets", env.API_FOOTBALL_KEY);
  const data = result.ok && Array.isArray(result.data?.response)
    ? result.data.response.map(item => ({
        id: Number(item?.id ?? 0) || null,
        name: item?.name ?? null
      })).filter(item => item.id && item.name)
    : [];

  return {
    provider: "api-football",
    results: data.length,
    data,
    diagnostic: providerDiagnostic(result)
  };
}

export async function apiFootballSports(date, env) {
  if (!env.API_FOOTBALL_KEY) {
    return { provider: "api-football", results: 0, data: [], diagnostic: { status: null, errors: { configuration: "API_FOOTBALL_KEY ausente" } } };
  }
  const result = await apiFetch(
    `/fixtures?date=${encodeURIComponent(date)}&timezone=America/Sao_Paulo`,
    env.API_FOOTBALL_KEY
  );
  const data = result.ok && Array.isArray(result.data?.response)
    ? result.data.response.map(normalizeFixture)
    : [];
  return {
    provider: "api-football",
    results: data.length,
    data,
    diagnostic: providerDiagnostic(result)
  };
}

export async function apiFootballFixture(id, env) {
  if (!env.API_FOOTBALL_KEY) return null;
  const result = await apiFetch(
    `/fixtures?ids=${encodeURIComponent(id)}`,
    env.API_FOOTBALL_KEY
  );
  if (!result.ok || !Array.isArray(result.data?.response) || !result.data.response[0]) {
    return null;
  }
  return normalizeFixture(result.data.response[0]);
}