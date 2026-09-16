import assert from "node:assert/strict";
import { calculateGreenScore, historyCore } from "../cloudflare/history-core.js";

// Confirma depreciação do historyCore (paginação SportMonks não existe mais).
const legacy = await historyCore();
assert.equal(legacy.statusCode, 501);
assert.match(String(legacy.body.error || ""), /legado removido/i);

// Motor estatístico é determinístico e independente de paginação de API.
const make = (id, gf, ga, corners = 9, yc = 4) => ({
  id,
  goalsFor: gf,
  goalsAgainst: ga,
  result: gf > ga ? "W" : gf < ga ? "L" : "D",
  statisticsNormalized: [
    { category: "corners", value: corners },
    { category: "yellowCards", value: yc }
  ]
});

const home = Array.from({ length: 5 }, (_, i) => make(100 + i, 2, 1, 10, 3));
const away = Array.from({ length: 5 }, (_, i) => make(200 + i, 1, 2, 8, 5));

const a = calculateGreenScore({ matches: home }, { matches: away }, home, away);
const b = calculateGreenScore({ matches: home }, { matches: away }, home, away);

assert.equal(a.markets.length, b.markets.length);
assert.deepEqual(
  a.markets.map(m => [m.market, m.probability, m.confidenceScore]),
  b.markets.map(m => [m.market, m.probability, m.confidenceScore])
);
assert.equal(a.oddsInfluence, false);

console.log("\n✅ test-history-pagination: legado 501 + cálculo determinístico do motor validados.");
