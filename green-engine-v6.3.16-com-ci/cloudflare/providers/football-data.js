/**
 * Provider football-data.org (free tier: 12 competições, 10 req/min).
 * Usado como fallback quando API-Football está em rate-limit.
 */

const BASE = "https://api.football-data.org/v4";
const FETCH_TIMEOUT_MS = 12000;

/** Competições do plano free (códigos oficiais). */
export const FREE_COMPETITION_CODES = [
  "PL", "PD", "BL1", "SA", "FL1", "DED", "PPL", "ELC", "BSA", "CL", "WC", "EC"
];

export function footballDataConfigured(env) {
  return Boolean(env?.FOOTBALL_DATA_API_KEY && String(env.FOOTBALL_DATA_API_KEY).trim());
}

async function apiFetch(path, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: {
        "X-Auth-Token": apiKey,
        Accept: "application/json"
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

function isRateLimited(result) {
  if (!result) return false;
  if (result.status === 429) return true;
  const msg = JSON.stringify(result.data || {});
  return /rate\s*limit|too many requests|exceeded/i.test(msg);
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesLooselyMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ").filter(t => t.length > 2));
  const tb = new Set(nb.split(" ").filter(t => t.length > 2));
  if (!ta.size || !tb.size) return false;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit >= Math.min(2, Math.min(ta.size, tb.size));
}

function mapMatchToSportsItem(match) {
  const home = match?.homeTeam || {};
  const away = match?.awayTeam || {};
  const competition = match?.competition || {};
  const date = match?.utcDate || null;
  const homeName = home.name || "Casa";
  const awayName = away.name || "Fora";
  return {
    provider: "football-data",
    id: Number(match?.id) || null,
    fixture_id: Number(match?.id) || null,
    date,
    starting_at: date,
    timestamp: date ? Math.floor(new Date(date).getTime() / 1000) : null,
    timezone: "UTC",
    status: {
      long: match?.status || null,
      short: match?.status || null,
      elapsed: null,
      extra: null
    },
    state: match?.status || null,
    name: `${homeName} vs ${awayName}`,
    home: { id: Number(home.id) || null, name: homeName },
    away: { id: Number(away.id) || null, name: awayName },
    participants: [
      { id: Number(home.id) || null, name: homeName, location: "home" },
      { id: Number(away.id) || null, name: awayName, location: "away" }
    ],
    league: {
      id: Number(competition.id) || null,
      name: competition.name || competition.code || null,
      country: competition.area?.name || null,
      season: match?.season?.startDate ? String(match.season.startDate).slice(0, 4) : null
    },
    scores: {
      home: match?.score?.fullTime?.home ?? match?.score?.regularTime?.home ?? null,
      away: match?.score?.fullTime?.away ?? match?.score?.regularTime?.away ?? null
    }
  };
}

/**
 * Jogos do dia nas competições free.
 */
export async function footballDataSports(date, env) {
  const apiKey = env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    return { data: [], diagnostic: { configured: false } };
  }
  const day = String(date).slice(0, 10);
  const result = await apiFetch(`/matches?dateFrom=${day}&dateTo=${day}`, apiKey);
  if (isRateLimited(result)) {
    return {
      data: [],
      diagnostic: { configured: true, status: 429, errors: { rateLimit: true }, provider: "football-data" },
      rateLimited: true
    };
  }
  const matches = Array.isArray(result.data?.matches) ? result.data.matches : [];
  const data = matches.map(mapMatchToSportsItem).filter(g => g.id);
  return {
    data,
    diagnostic: {
      configured: true,
      status: result.status,
      count: data.length,
      errors: result.ok ? null : result.data,
      provider: "football-data"
    },
    rateLimited: false
  };
}

export async function footballDataFixture(id, env, context = {}) {
  const apiKey = env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return null;

  if (id && /^\d+$/.test(String(id))) {
    const byId = await apiFetch(`/matches/${id}`, apiKey);
    if (isRateLimited(byId)) return { __rateLimited: true, stage: "matches?id", provider: "football-data" };
    if (byId.ok && byId.data?.id) return mapMatchToSportsItem(byId.data);
  }

  const day = context?.date ? String(context.date).slice(0, 10) : null;
  const home = context?.home;
  const away = context?.away;
  if (!day || !home || !away) return null;

  const byDate = await apiFetch(`/matches?dateFrom=${day}&dateTo=${day}`, apiKey);
  if (isRateLimited(byDate)) return { __rateLimited: true, stage: "matches?date", provider: "football-data" };
  const matches = Array.isArray(byDate.data?.matches) ? byDate.data.matches : [];
  const found = matches.find(m =>
    namesLooselyMatch(m?.homeTeam?.name, home) && namesLooselyMatch(m?.awayTeam?.name, away)
  );
  return found ? mapMatchToSportsItem(found) : null;
}

export async function footballDataTeamMatches(teamId, env, { limit = 10, status = "FINISHED" } = {}) {
  const apiKey = env.FOOTBALL_DATA_API_KEY;
  if (!apiKey || !teamId) return { matches: [], rateLimited: false };
  const result = await apiFetch(
    `/teams/${teamId}/matches?status=${encodeURIComponent(status)}&limit=${limit}`,
    apiKey
  );
  if (isRateLimited(result)) return { matches: [], rateLimited: true };
  const matches = Array.isArray(result.data?.matches) ? result.data.matches : [];
  return { matches, rateLimited: false };
}

export { namesLooselyMatch, normalizeName, mapMatchToSportsItem };
