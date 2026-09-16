import assert from "node:assert/strict";
import { calculateGreenScore, historyCore } from "../cloudflare/history-core.js";

const legacy = await historyCore();
assert.equal(legacy.statusCode, 501);
assert.equal(legacy.body.provider, "api-football");

// Fallback de janela: quando não há partidas de venue específico,
// calculateGreenScore usa o histórico geral (homeVenueMatches / awayVenueMatches vazios).
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

const homeMatches = [
  make(1, 3, 0),
  make(2, 2, 1),
  make(3, 1, 1),
  make(4, 2, 0),
  make(5, 0, 0)
];
const awayMatches = [
  make(6, 0, 2),
  make(7, 1, 1),
  make(8, 0, 3),
  make(9, 1, 0),
  make(10, 2, 2)
];

const withVenue = calculateGreenScore(
  { matches: homeMatches },
  { matches: awayMatches },
  homeMatches,
  awayMatches
);
const withoutVenue = calculateGreenScore(
  { matches: homeMatches },
  { matches: awayMatches },
  [],
  []
);

assert.equal(withVenue.markets.length, 16);
assert.equal(withoutVenue.markets.length, 16);

// Mercados de gols/BTTS/escanteios/cartões não dependem de venue — devem bater.
const goalMarkets = ["Mais de 1.5 gols", "Mais de 2.5 gols", "Ambas marcam"];
for (const name of goalMarkets) {
  const a = withVenue.markets.find(m => m.market === name);
  const b = withoutVenue.markets.find(m => m.market === name);
  assert.ok(a && b, `mercado ${name} deve existir`);
  assert.equal(a.probability, b.probability, `${name} deve ser estável sem venue`);
}

// Casa/Fora +0.5 usam venue quando disponível; sem venue caem no histórico geral.
const homeDcVenue = withVenue.markets.find(m => m.market === "Casa +0.5");
const homeDcFallback = withoutVenue.markets.find(m => m.market === "Casa +0.5");
assert.ok(homeDcVenue && homeDcFallback);
assert.ok(Number(homeDcFallback.probability) >= 0 && Number(homeDcFallback.probability) <= 1);

console.log("\n✅ test-history-window-fallback: legado 501 + fallback de venue validados.");
