/**
 * Odds pré-jogo via API-Football /odds?fixture=
 * Free: 1 request por fixture; cachear no caller.
 */

const BASE = "https://v3.football.api-sports.io";
const FETCH_TIMEOUT_MS = 12000;

async function apiFetch(path, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: {
        "x-apisports-key": apiKey,
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
  const errors = result.data?.errors;
  if (!errors) return false;
  const blob = JSON.stringify(errors);
  return /rate\s*limit|too many requests|exceeded/i.test(blob);
}

function flattenBookmaker(bookmaker) {
  const out = {
    bookmakerId: bookmaker?.id ?? null,
    bookmakerName: bookmaker?.name || null,
    lines: {}
  };
  const bets = Array.isArray(bookmaker?.bets) ? bookmaker.bets : [];
  for (const bet of bets) {
    const betName = String(bet?.name || "").trim();
    const values = Array.isArray(bet?.values) ? bet.values : [];
    for (const row of values) {
      const label = String(row?.value || "").trim();
      const odd = Number(row?.odd);
      if (!label || !Number.isFinite(odd) || odd <= 1) continue;
      const key = `${betName}::${label}`.toLowerCase();
      out.lines[key] = { betName, label, odd };
    }
  }
  return out;
}

function resolveOddForMarket(marketName, flat) {
  const m = String(marketName || "").toLowerCase();
  const lines = flat?.lines || {};
  const find = (...predicates) => {
    for (const [key, row] of Object.entries(lines)) {
      if (predicates.every(fn => fn(key, row))) return row;
    }
    return null;
  };

  if (m.includes("mais de 1.5") || m.includes("over 1.5")) {
    return find(k => k.includes("over/under") || k.includes("goals over"), k => k.includes("over 1.5"));
  }
  if (m.includes("mais de 2.5")) {
    return find(k => k.includes("over/under") || k.includes("goals"), k => k.includes("over 2.5"));
  }
  if (m.includes("menos de 2.5")) {
    return find(k => k.includes("over/under") || k.includes("goals"), k => k.includes("under 2.5"));
  }
  if (m.includes("menos de 3.5")) {
    return find(k => k.includes("over/under") || k.includes("goals"), k => k.includes("under 3.5"));
  }

  if (m.includes("ambas marcam") && !m.includes("não") && !m.includes("nao")) {
    return find(k => k.includes("both teams") || k.includes("btts"), k => /\byes\b/.test(k) || k.endsWith("::yes"));
  }
  if (m.includes("ambas não") || m.includes("ambas nao")) {
    return find(k => k.includes("both teams") || k.includes("btts"), k => /\bno\b/.test(k) || k.endsWith("::no"));
  }

  if (m.includes("casa +0.5")) {
    return find(k => k.includes("double chance"), k => k.includes("home") || k.includes("1x"));
  }
  if (m.includes("fora +0.5")) {
    return find(k => k.includes("double chance"), k => k.includes("away") || k.includes("x2"));
  }

  return null;
}

export async function apiFootballOdds(fixtureId, env) {
  const apiKey = env?.API_FOOTBALL_KEY;
  if (!apiKey || !fixtureId) {
    return { ok: false, rateLimited: false, odds: null, error: "missing key or fixture" };
  }

  const result = await apiFetch(`/odds?fixture=${encodeURIComponent(fixtureId)}`, apiKey);
  if (isRateLimited(result)) {
    return { ok: false, rateLimited: true, odds: null, error: "rate-limit", diagnostic: result.data?.errors };
  }
  if (!result.ok) {
    return { ok: false, rateLimited: false, odds: null, error: "upstream", status: result.status };
  }

  const rows = Array.isArray(result.data?.response) ? result.data.response : [];
  const first = rows[0];
  const bookmakers = Array.isArray(first?.bookmakers) ? first.bookmakers : [];
  if (!bookmakers.length) {
    return { ok: false, rateLimited: false, odds: null, error: "no-bookmakers", update: first?.update || null };
  }

  const preferred = bookmakers.find(b => /bet365|pinnacle|betfair|1xbet/i.test(String(b?.name || ""))) || bookmakers[0];
  const flat = flattenBookmaker(preferred);

  return {
    ok: true,
    rateLimited: false,
    odds: {
      fixtureId: Number(fixtureId),
      update: first?.update || null,
      bookmaker: { id: flat.bookmakerId, name: flat.bookmakerName },
      bookmakerCount: bookmakers.length,
      lines: flat.lines
    },
    error: null
  };
}

export function enrichMarketsWithOdds(greenScore, oddsBundle) {
  if (!greenScore || !Array.isArray(greenScore.markets) || !oddsBundle?.lines) {
    return { greenScore, oddsAttached: false, matched: 0 };
  }

  let matched = 0;
  const markets = greenScore.markets.map(m => {
    const hit = resolveOddForMarket(m.market, oddsBundle);
    if (!hit) {
      return {
        ...m,
        odd: null,
        impliedProbability: null,
        valueEdge: null,
        oddsBookmaker: null
      };
    }
    matched += 1;
    const odd = Number(hit.odd);
    const implied = odd > 0 ? 1 / odd : null;
    const modelP = Number(m.probability);
    const valueEdge =
      Number.isFinite(modelP) && Number.isFinite(odd) ? Number((modelP * odd - 1).toFixed(4)) : null;
    return {
      ...m,
      odd,
      impliedProbability: implied != null ? Number(implied.toFixed(4)) : null,
      valueEdge,
      oddsBookmaker: oddsBundle.bookmakerName || oddsBundle.bookmaker?.name || null,
      oddsLabel: hit.label
    };
  });

  return {
    greenScore: {
      ...greenScore,
      markets,
      oddsInfluence: false,
      oddsSource: {
        provider: "api-football",
        bookmaker: oddsBundle.bookmaker || { name: oddsBundle.bookmakerName },
        update: oddsBundle.update || null,
        matchedMarkets: matched
      }
    },
    oddsAttached: matched > 0,
    matched
  };
}

export { resolveOddForMarket, flattenBookmaker };
