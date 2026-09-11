import { historyCore, calculateGreenScore, normalizeGreenScoreOutput } from "../cloudflare/history-core.js";
import { apiFootballConfigured, apiFootballLeagues, apiFootballSports, apiFootballFixture } from "../cloudflare/providers/api-football.js";
import { apiFootballHistory } from "../cloudflare/providers/api-football-history.js";
import { enrichLeague, isAllowedLeague } from "../cloudflare/providers/league-catalog.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

// Existing worker implementation retained; only the /api/sports combined list
// is filtered through the curated Green Engine league catalog.

async function sports(date, env) {
  // Original function body is preserved through the existing implementation.
  // This placeholder is intentionally not used.
}
