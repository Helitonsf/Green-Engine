import assert from "node:assert/strict";
import { calculateGreenScore, normalizeGreenScoreOutput } from "../cloudflare/history-core.js";

const makeMatch = (id, goalsFor, goalsAgainst, corners = 9, yellowCards = 4) => ({
  id,
  goalsFor,
  goalsAgainst,
  result: goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D",
  statisticsNormalized: [
    { category: "corners", value: corners },
    { category: "yellowCards", value: yellowCards }
  ]
});

const homeMatches = [
  makeMatch(1, 2, 0, 10, 3),
  makeMatch(2, 1, 1, 9, 4),
  makeMatch(3, 3, 1, 11, 5),
  makeMatch(4, 0, 1, 8, 2),
  makeMatch(5, 2, 2, 10, 4)
];

const awayMatches = [
  makeMatch(6, 0, 2, 8, 3),
  makeMatch(7, 1, 1, 9, 4),
  makeMatch(8, 2, 3, 12, 5),
  makeMatch(9, 2, 0, 10, 4),
  makeMatch(10, 1, 2, 9, 3)
];

const homeHistory = { matches: homeMatches, sampleSize: 5 };
const awayHistory = { matches: awayMatches, sampleSize: 5 };

const score = calculateGreenScore(homeHistory, awayHistory, homeMatches, awayMatches);
const normalized = normalizeGreenScoreOutput(score);

assert.equal(normalized.oddsInfluence, false);
assert.equal(normalized.markets.length, 14);
assert.ok(normalized.markets.every(m => Number(m.probability) >= 0 && Number(m.probability) <= 1));
assert.ok(normalized.markets.every(m => Number(m.confidenceScore) >= 0 && Number(m.confidenceScore) <= 100));
assert.ok(normalized.markets.some(m => m.market === "Escanteios Over 8.5"));
assert.ok(normalized.markets.some(m => m.market === "Cartões amarelos Over 3.5"));
assert.ok(normalized.ranking.length === normalized.markets.length);

console.log("\n✅ test-history-core: cálculo API-Football e ranking validados sem odds.");
