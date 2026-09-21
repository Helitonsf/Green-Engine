import assert from "node:assert/strict";
import {
  resolveSportKey,
  resolveOddForMarket,
  enrichMarketsWithOdds,
  flattenEventOdds
} from "../cloudflare/providers/the-odds-api.js";

assert.equal(resolveSportKey({ code: "PL" }), "soccer_epl");
assert.equal(resolveSportKey({ name: "Campeonato Brasileiro Série A" }), "soccer_brazil_campeonato");
assert.equal(resolveSportKey({ name: "UEFA Champions League" }), "soccer_uefa_champs_league");
assert.equal(resolveSportKey({ name: "Unknown League XYZ" }), null);

const fakeEvent = {
  id: "evt1",
  home_team: "São Paulo FC",
  away_team: "SC Internacional",
  bookmakers: [
    {
      key: "pinnacle",
      title: "Pinnacle",
      markets: [
        {
          key: "totals",
          outcomes: [
            { name: "Over", point: 2.5, price: 1.95 },
            { name: "Under", point: 2.5, price: 1.9 },
            { name: "Over", point: 3.5, price: 2.4 },
            { name: "Under", point: 3.5, price: 1.55 }
          ]
        },
        {
          key: "h2h",
          outcomes: [
            { name: "São Paulo FC", price: 2.1 },
            { name: "Draw", price: 3.2 },
            { name: "SC Internacional", price: 3.5 }
          ]
        }
      ]
    }
  ]
};

const flat = flattenEventOdds(fakeEvent);
assert.ok(flat);
assert.equal(flat.bookmaker.name, "Pinnacle");
assert.ok(flat.lines["totals::under_3.5"]);
assert.equal(flat.lines["totals::under_3.5"].odd, 1.55);

const under35 = resolveOddForMarket("Menos de 3.5 gols", flat);
assert.equal(under35.odd, 1.55);

const greenScore = {
  markets: [
    { market: "Menos de 3.5 gols", probability: 0.8, confidenceScore: 84 },
    { market: "Mais de 2.5 gols", probability: 0.45, confidenceScore: 60 },
    { market: "Cartões amarelos Over 3.5", probability: 0.55, confidenceScore: 50 }
  ],
  oddsInfluence: false
};

const { greenScore: enriched, oddsAttached, matched } = enrichMarketsWithOdds(greenScore, {
  ...flat,
  provider: "the-odds-api",
  bookmaker: flat.bookmaker
});

assert.equal(oddsAttached, true);
assert.equal(matched, 2); // under 3.5 + over 2.5; cards sem linha
assert.equal(enriched.markets[0].odd, 1.55);
assert.ok(enriched.markets[0].valueEdge != null);
assert.equal(enriched.markets[1].odd, 1.95); // Mais de 2.5
assert.equal(enriched.markets[2].odd, null);
assert.equal(enriched.oddsInfluence, false);
assert.equal(enriched.oddsSource.provider, "the-odds-api");

console.log("✅ test-the-odds-api: sport keys, flatten, enrich e valueEdge OK.");
