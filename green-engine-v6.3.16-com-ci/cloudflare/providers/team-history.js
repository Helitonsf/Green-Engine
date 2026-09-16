/**
 * Histórico por time — compatível com plano free da API-Football.
 * Free bloqueia last=/next= ("Free plans do not have access to the Last parameter").
 *
 * Ordem: season → from/to → last (pago).
 */

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const FETCH_TIMEOUT_MS = 10000;
const HISTORY_CANDIDATES = 8;

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

function isRateLimited(result) {
  if (!result) return false;
  if (result.status === 429) return true;
  const errors = result?.data?.errors;
  if (!errors) return false;
  const text = typeof errors === "string" ? errors : JSON.stringify(errors);
  return /rate\s*limit|too many requests|exceeded the limit/i.test(text);
}

function isPlanRestricted(result) {
  if (!result) return false;
  const errors = result?.data?.errors;
  if (!errors) return false;
  const text = typeof errors === "string" ? errors : JSON.stringify(errors);
  return /do not have access to the Last parameter|Free plans do not have access|not available for your plan|plan.*last/i.test(text);
}

/**
 * @returns {{ result, path, mode, rateLimited, planRestricted? }}
 */
export async function fetchTeamRecentFixtures(teamId, fixture, apiKey) {
  const season =
    Number(fixture?.league?.season) ||
    Number(String(fixture?.fixture?.date || "").slice(0, 4)) ||
    null;

  // 1) team+season (funciona no free)
  if (season) {
    const bySeason = await apiFetch(
      `/fixtures?team=${teamId}&season=${season}&timezone=America/Sao_Paulo`,
      apiKey
    );
    if (isRateLimited(bySeason)) {
      return { result: bySeason, path: `team=${teamId}&season=${season}`, mode: "season", rateLimited: true };
    }
    const seasonRows = Array.isArray(bySeason.data?.response) ? bySeason.data.response : [];
    if (seasonRows.length) {
      return { result: bySeason, path: `team=${teamId}&season=${season}`, mode: "season", rateLimited: false };
    }
  }

  // 2) from/to (~120 dias antes do jogo)
  const fixtureDate = new Date(fixture?.fixture?.date || Date.now());
  if (!Number.isNaN(fixtureDate.getTime())) {
    const to = fixtureDate.toISOString().slice(0, 10);
    const fromDate = new Date(fixtureDate.getTime() - 120 * 24 * 60 * 60 * 1000);
    const from = fromDate.toISOString().slice(0, 10);
    const byRange = await apiFetch(
      `/fixtures?team=${teamId}&from=${from}&to=${to}&timezone=America/Sao_Paulo`,
      apiKey
    );
    if (isRateLimited(byRange)) {
      return { result: byRange, path: `team=${teamId}&from=${from}&to=${to}`, mode: "from-to", rateLimited: true };
    }
    const rangeRows = Array.isArray(byRange.data?.response) ? byRange.data.response : [];
    if (rangeRows.length) {
      return { result: byRange, path: `team=${teamId}&from=${from}&to=${to}`, mode: "from-to", rateLimited: false };
    }
  }

  // 3) last= (planos pagos)
  const byLast = await apiFetch(
    `/fixtures?team=${teamId}&last=${HISTORY_CANDIDATES}&timezone=America/Sao_Paulo`,
    apiKey
  );
  if (isRateLimited(byLast)) {
    return { result: byLast, path: `team=${teamId}&last=${HISTORY_CANDIDATES}`, mode: "last", rateLimited: true };
  }
  return {
    result: byLast,
    path: `team=${teamId}&last=${HISTORY_CANDIDATES}`,
    mode: "last",
    rateLimited: false,
    planRestricted: isPlanRestricted(byLast)
  };
}

export { isRateLimited, isPlanRestricted };
