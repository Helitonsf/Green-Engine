import { enrichLeague, isAllowedLeague } from "./league-catalog.js";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const FETCH_TIMEOUT_MS = 10000;

function normalizeTeamName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|afc|club|football|futbol|f\.?c\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameTeamName(a, b) {
  const left = normalizeTeamName(a);
  const right = normalizeTeamName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function matchesContext(fixture, context = {}) {
  const date = String(context?.date || "").slice(0, 10);
  const homeName = context?.home;
  const awayName = context?.away;
  if (!homeName || !awayName) return true;

  const teamsOk = sameTeamName(fixture?.teams?.home?.name, homeName)
    && sameTeamName(fixture?.teams?.away?.name, awayName);
  if (!teamsOk) return false;
  if (!date) return true;

  const fixtureDate = String(fixture?.fixture?.date || "").slice(0, 10);
  if (fixtureDate === date) return true;
  // Tolerância ±1 dia (fuso BRT/UTC em jogos noturnos)
  try {
    const base = new Date(date + "T12:00:00Z").getTime();
    const fx = new Date(fixtureDate + "T12:00:00Z").getTime();
    return Number.isFinite(base) && Number.isFinite(fx) && Math.abs(base - fx) <= 86400000;
  } catch {
    return false;
  }
}

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

function isRateLimitedResult(result) {
  const errors = result?.data?.errors;
  if (!errors || typeof errors !== "object") return false;
  const blob = JSON.stringify(errors).toLowerCase();
  return blob.includes("rate limit") || blob.includes("too many requests");
}

export async function apiFootballFixture(id, env, context = {}) {
  if (!env.API_FOOTBALL_KEY) return null;
  const fixtureId = String(id).trim();
  if (!/^\d+$/.test(fixtureId)) return null;

  // Ordem: id → ids → date (context). Rate-limit não vira "não encontrado".
  const primary = await apiFetch(
    `/fixtures?id=${encodeURIComponent(fixtureId)}`,
    env.API_FOOTBALL_KEY
  );
  if (isRateLimitedResult(primary)) {
    return { __rateLimited: true, stage: "fixtures?id", diagnostic: providerDiagnostic(primary) };
  }
  const primaryFixture = primary.ok && Array.isArray(primary.data?.response)
    ? primary.data.response[0]
    : null;
  if (primaryFixture) {
    return normalizeFixture(primaryFixture);
  }

  const fallback = await apiFetch(
    `/fixtures?ids=${encodeURIComponent(fixtureId)}`,
    env.API_FOOTBALL_KEY
  );
  if (isRateLimitedResult(fallback)) {
    return { __rateLimited: true, stage: "fixtures?ids", diagnostic: providerDiagnostic(fallback) };
  }
  const fallbackFixture = fallback.ok && Array.isArray(fallback.data?.response)
    ? fallback.data.response[0]
    : null;
  if (fallbackFixture) {
    return normalizeFixture(fallbackFixture);
  }

  const date = String(context?.date || "").slice(0, 10);
  const homeName = context?.home;
  const awayName = context?.away;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && homeName && awayName) {
    const byDate = await apiFetch(
      `/fixtures?date=${encodeURIComponent(date)}&timezone=America/Sao_Paulo`,
      env.API_FOOTBALL_KEY
    );
    if (isRateLimitedResult(byDate)) {
      return { __rateLimited: true, stage: "fixtures?date", diagnostic: providerDiagnostic(byDate) };
    }
    const candidates = Array.isArray(byDate.data?.response) ? byDate.data.response : [];
    const contextualMatch = candidates.find(item => matchesContext(item, context));
    if (contextualMatch) return normalizeFixture(contextualMatch);
  }

  return null;
}
