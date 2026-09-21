/**
 * Odds pré-jogo via The Odds API (https://the-odds-api.com).
 * Secret opcional: THE_ODDS_API_KEY
 * Free: ~500 créditos/mês; 1 crédito ≈ 1 market × 1 region por request.
 *
 * Match por nomes de times + data (IDs não batem com football-data).
 */

const BASE = "https://api.the-odds-api.com/v4";
const FETCH_TIMEOUT_MS = 12000;

/** Mapa competition code / nome football-data → sport_key The Odds API */
const SPORT_KEY_BY_CODE = {
  PL: "soccer_epl",
  PD: "soccer_spain_la_liga",
  BL1: "soccer_germany_bundesliga",
  SA: "soccer_italy_serie_a",
  FL1: "soccer_france_ligue_one",
  DED: "soccer_netherlands_eredivisie",
  PPL: "soccer_portugal_primeira_liga",
  ELC: "soccer_efl_champ",
  BSA: "soccer_brazil_campeonato",
  CL: "soccer_uefa_champs_league",
  WC: "soccer_fifa_world_cup",
  EC: "soccer_uefa_european_championship"
};

const SPORT_KEY_BY_NAME = [
  [/premier\s*league/i, "soccer_epl"],
  [/la\s*liga|primera\s*division|laliga/i, "soccer_spain_la_liga"],
  [/bundesliga/i, "soccer_germany_bundesliga"],
  [/serie\s*a/i, "soccer_italy_serie_a"],
  [/ligue\s*1/i, "soccer_france_ligue_one"],
  [/eredivisie/i, "soccer_netherlands_eredivisie"],
  [/primeira\s*liga|liga\s*portugal/i, "soccer_portugal_primeira_liga"],
  [/championship/i, "soccer_efl_champ"],
  [/brasileir[aã]o|serie\s*a.*brazil|campeonato\s*brasileiro/i, "soccer_brazil_campeonato"],
  [/champions\s*league|uefa\s*champions/i, "soccer_uefa_champs_league"],
  [/world\s*cup|copa\s*do\s*mundo/i, "soccer_fifa_world_cup"],
  [/european\s*championship|euro\s*20|uefa\s*euro/i, "soccer_uefa_european_championship"]
];

export function theOddsApiConfigured(env) {
  return Boolean(env?.THE_ODDS_API_KEY && String(env.THE_ODDS_API_KEY).trim());
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

function resolveSportKey(league) {
  if (!league) return null;
  const code = String(league.code || league.id || "").toUpperCase();
  if (SPORT_KEY_BY_CODE[code]) return SPORT_KEY_BY_CODE[code];
  const name = String(league.name || league || "");
  for (const [re, key] of SPORT_KEY_BY_NAME) {
    if (re.test(name)) return key;
  }
  return null;
}

async function apiFetch(path, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${BASE}${path}${sep}apiKey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      data,
      remaining: response.headers.get("x-requests-remaining"),
      used: response.headers.get("x-requests-used")
    };
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
  if (result.status === 429 || result.status === 401) return true;
  const msg = JSON.stringify(result.data || {});
  return /quota|rate\s*limit|out of usage|exceeded/i.test(msg);
}

function flattenEventOdds(event) {
  const bookmakers = Array.isArray(event?.bookmakers) ? event.bookmakers : [];
  if (!bookmakers.length) return null;

  const preferred =
    bookmakers.find(b => /pinnacle|betfair|bet365|draftkings|fanduel/i.test(String(b?.title || b?.key || ""))) ||
    bookmakers[0];

  const lines = {};
  const markets = Array.isArray(preferred?.markets) ? preferred.markets : [];

  for (const market of markets) {
    const key = String(market?.key || "").toLowerCase();
    const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];

    if (key === "h2h") {
      for (const o of outcomes) {
        const name = String(o?.name || "").toLowerCase();
        const price = Number(o?.price);
        if (!Number.isFinite(price) || price <= 1) continue;
        if (name === "draw" || name === "x") {
          lines["h2h::draw"] = { betName: "Match Winner", label: "Draw", odd: price };
        } else if (namesLooselyMatch(o.name, event.home_team)) {
          lines["h2h::home"] = { betName: "Match Winner", label: "Home", odd: price };
        } else if (namesLooselyMatch(o.name, event.away_team)) {
          lines["h2h::away"] = { betName: "Match Winner", label: "Away", odd: price };
        }
      }
    }

    if (key === "totals") {
      for (const o of outcomes) {
        const name = String(o?.name || "").toLowerCase();
        const point = Number(o?.point);
        const price = Number(o?.price);
        if (!Number.isFinite(price) || price <= 1 || !Number.isFinite(point)) continue;
        const side = name.includes("over") ? "over" : name.includes("under") ? "under" : null;
        if (!side) continue;
        const pointKey = point.toFixed(1).replace(/\.0$/, "");
        lines[`totals::${side}_${pointKey}`] = {
          betName: "Goals Over/Under",
          label: `${side === "over" ? "Over" : "Under"} ${point}`,
          odd: price,
          point
        };
      }
    }

    if (key === "btts" || key === "both_teams_to_score") {
      for (const o of outcomes) {
        const name = String(o?.name || "").toLowerCase();
        const price = Number(o?.price);
        if (!Number.isFinite(price) || price <= 1) continue;
        if (/\byes\b|sim/.test(name)) {
          lines["btts::yes"] = { betName: "Both Teams To Score", label: "Yes", odd: price };
        } else if (/\bno\b|nao|não/.test(name)) {
          lines["btts::no"] = { betName: "Both Teams To Score", label: "No", odd: price };
        }
      }
    }

    if (key === "double_chance") {
      for (const o of outcomes) {
        const name = String(o?.name || "").toLowerCase();
        const price = Number(o?.price);
        if (!Number.isFinite(price) || price <= 1) continue;
        if (/home|1x|home or draw/.test(name)) {
          lines["dc::1x"] = { betName: "Double Chance", label: "1X", odd: price };
        } else if (/away|x2|draw or away/.test(name)) {
          lines["dc::x2"] = { betName: "Double Chance", label: "X2", odd: price };
        } else if (/12|home or away/.test(name)) {
          lines["dc::12"] = { betName: "Double Chance", label: "12", odd: price };
        }
      }
    }
  }

  return {
    eventId: event?.id || null,
    homeTeam: event?.home_team || null,
    awayTeam: event?.away_team || null,
    commenceTime: event?.commence_time || null,
    bookmaker: { key: preferred?.key || null, name: preferred?.title || preferred?.key || null },
    bookmakerCount: bookmakers.length,
    lines
  };
}

function resolveOddForMarket(marketName, oddsBundle) {
  const m = String(marketName || "").toLowerCase();
  const mn = normalizeName(marketName);
  const lines = oddsBundle?.lines || {};

  if (/cartao|cartoes|corner|escanteio|chute|shot|falta|foul|posse|possession/i.test(mn)) {
    return null;
  }

  if (m.includes("mais de 1.5") || m.includes("over 1.5")) {
    return lines["totals::over_1.5"] || null;
  }
  if (m.includes("mais de 2.5") || m.includes("over 2.5")) {
    return lines["totals::over_2.5"] || null;
  }
  if (m.includes("menos de 2.5") || m.includes("under 2.5")) {
    return lines["totals::under_2.5"] || null;
  }
  if (m.includes("menos de 3.5") || m.includes("under 3.5")) {
    return lines["totals::under_3.5"] || null;
  }
  if (m.includes("mais de 3.5") || m.includes("over 3.5")) {
    return lines["totals::over_3.5"] || null;
  }

  if ((m.includes("ambas marcam") || m.includes("ambas marcam")) && !m.includes("não") && !m.includes("nao")) {
    return lines["btts::yes"] || null;
  }
  if (m.includes("ambas não") || m.includes("ambas nao")) {
    return lines["btts::no"] || null;
  }

  if (m.includes("casa +0.5") || m.includes("1x")) {
    return lines["dc::1x"] || null;
  }
  if (m.includes("fora +0.5") || m.includes("x2")) {
    return lines["dc::x2"] || null;
  }

  return null;
}

export async function theOddsApiOdds(fixture, env) {
  const apiKey = env?.THE_ODDS_API_KEY;
  if (!apiKey) {
    return { ok: false, rateLimited: false, odds: null, error: "missing THE_ODDS_API_KEY" };
  }

  const home = fixture?.home?.name || "";
  const away = fixture?.away?.name || "";
  if (!home || !away) {
    return { ok: false, rateLimited: false, odds: null, error: "missing team names" };
  }

  const leagueObj =
    typeof fixture?.league === "string"
      ? { name: fixture.league }
      : fixture?.league || {};
  const sportKey = resolveSportKey(leagueObj);
  if (!sportKey) {
    return {
      ok: false,
      rateLimited: false,
      odds: null,
      error: "unsupported-league",
      diagnostic: { league: leagueObj }
    };
  }

  let from = null;
  let to = null;
  if (fixture?.starting_at) {
    const t = new Date(fixture.starting_at).getTime();
    if (Number.isFinite(t)) {
      from = new Date(t - 36 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
      to = new Date(t + 36 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    }
  }

  let path = `/sports/${sportKey}/odds?regions=eu&markets=h2h,totals&oddsFormat=decimal`;
  if (from) path += `&commenceTimeFrom=${encodeURIComponent(from)}`;
  if (to) path += `&commenceTimeTo=${encodeURIComponent(to)}`;

  const result = await apiFetch(path, apiKey);
  if (isRateLimited(result)) {
    return {
      ok: false,
      rateLimited: true,
      odds: null,
      error: "rate-limit",
      diagnostic: { status: result.status, remaining: result.remaining, data: result.data }
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      rateLimited: false,
      odds: null,
      error: "upstream",
      status: result.status,
      diagnostic: result.data
    };
  }

  const events = Array.isArray(result.data) ? result.data : [];
  const match = events.find(
    e => namesLooselyMatch(e.home_team, home) && namesLooselyMatch(e.away_team, away)
  );
  if (!match) {
    return {
      ok: false,
      rateLimited: false,
      odds: null,
      error: "event-not-found",
      diagnostic: {
        sportKey,
        searched: { home, away },
        candidates: events.slice(0, 5).map(e => ({
          home: e.home_team,
          away: e.away_team,
          commence: e.commence_time
        })),
        remaining: result.remaining
      }
    };
  }

  const flat = flattenEventOdds(match);
  if (!flat || !Object.keys(flat.lines || {}).length) {
    return { ok: false, rateLimited: false, odds: null, error: "no-lines" };
  }

  return {
    ok: true,
    rateLimited: false,
    odds: {
      provider: "the-odds-api",
      sportKey,
      fixtureId: fixture?.id ?? null,
      eventId: flat.eventId,
      update: match?.bookmakers?.[0]?.last_update || null,
      bookmaker: flat.bookmaker,
      bookmakerCount: flat.bookmakerCount,
      lines: flat.lines,
      remaining: result.remaining,
      used: result.used
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
      Number.isFinite(modelP) && Number.isFinite(odd)
        ? Number((modelP * odd - 1).toFixed(4))
        : null;
    return {
      ...m,
      odd,
      impliedProbability: implied != null ? Number(implied.toFixed(4)) : null,
      valueEdge,
      oddsBookmaker: oddsBundle.bookmaker?.name || null,
      oddsLabel: hit.label
    };
  });

  return {
    greenScore: {
      ...greenScore,
      markets,
      oddsInfluence: false,
      oddsSource: {
        provider: oddsBundle.provider || "the-odds-api",
        bookmaker: oddsBundle.bookmaker || null,
        update: oddsBundle.update || null,
        matchedMarkets: matched,
        remaining: oddsBundle.remaining ?? null
      }
    },
    oddsAttached: matched > 0,
    matched
  };
}

export { resolveSportKey, resolveOddForMarket, flattenEventOdds, namesLooselyMatch };
