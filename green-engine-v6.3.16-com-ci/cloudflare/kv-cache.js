/**
 * Cache em Cloudflare KV para dados históricos da API-Football.
 * Funciona só quando o binding HISTORY_KV existe no Worker (wrangler.toml).
 * Sem KV: no-op — o código segue só com Cache API de edge.
 */

const DEFAULT_TTL_SECONDS = 3600; // 1h

export async function kvGetJson(kv, key) {
  if (!kv || !key) return null;
  try {
    const raw = await kv.get(key, { type: "text" });
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function kvPutJson(kv, key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!kv || !key || value == null) return false;
  try {
    const ttl = Math.max(60, Math.min(Number(ttlSeconds) || DEFAULT_TTL_SECONDS, 86400));
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
    return true;
  } catch {
    return false;
  }
}

/** Chave de jogos recentes de um time na temporada. */
export function teamSeasonKey(teamId, season) {
  return `team:${teamId}:season:${season}`;
}

/** Chave da análise completa /api/history por fixture. */
export function historyFixtureKey(fixtureId) {
  return `history:fixture:${fixtureId}`;
}
