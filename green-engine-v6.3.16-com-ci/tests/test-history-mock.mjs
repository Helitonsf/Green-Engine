import assert from "node:assert/strict";
import { calculateGreenScore } from "../cloudflare/history-core.js";

const match = (id, goalsFor, goalsAgainst, corners, yellowCards) => ({
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
  match(100001, 2, 0, 10, 3),
  match(100002, 1, 1, 9, 4),
  match(100003, 3, 1, 11, 5),
  match(100004, 0, 1, 8, 2),
  match(100005, 2, 2, 10, 4)
];

const awayMatches = [
  match(100006, 0, 2, 8, 3),
  match(100007, 1, 1, 9, 4),
  match(100008, 2, 3, 12, 5),
  match(100009, 2, 0, 10, 4),
  match(100010, 1, 2, 9, 3)
];

const result = calculateGreenScore(
  { matches: homeMatches },
  { matches: awayMatches },
  homeMatches,
  awayMatches
);

assert.equal(result.provider, "api-football");
assert.equal(result.oddsInfluence, false);
assert.equal(result.markets.length, 14);

for (const market of [
  "Escanteios Over 8.5",
  "Escanteios Over 10.5",
  "Escanteios Under 12.5",
  "Cartões amarelos Over 3.5",
  "Cartões amarelos Over 4.5",
  "Cartões amarelos Under 6.5"
]) {
  assert.ok(result.markets.some(item => item.market === market), `mercado ausente: ${market}`);
}

assert.ok(result.markets.every(item => item.oddsInfluence === false));
assert.ok(result.markets.every(item => Number(item.probability) >= 0 && Number(item.probability) <= 1));

console.log("\n✅ test-history-mock: API-Football statistical core validado sem SportMonks e sem odds.");
