import assert from "node:assert/strict";
import { apiFootballHistory } from "../cloudflare/providers/api-football-history.js";

const fixtureId = 19722813;
const fixtureDate = "2026-08-09T12:30:00+00:00";
const homeId = 180;
const awayId = 53;

function makeFixture(id, home, away, date, homeGoals, awayGoals) {
  return {
    fixture: { id, date, status: { long: "Match Finished" } },
    teams: {
      home: { id: home, name: home === homeId ? "Kilmarnock" : "Team Home" },
      away: { id: away, name: away === awayId ? "Celtic" : "Team Away" }
    },
    goals: { home: homeGoals, away: awayGoals },
    league: { name: "Premiership" },
    statistics: [
      { team: { id: home }, statistics: [
        { type: "Corner Kicks", value: 9 },
        { type: "Yellow Cards", value: 4 },
        { type: "Ball Possession", value: "55%" },
        { type: "Total Shots", value: 12 }
      ] },
      { team: { id: away }, statistics: [
        { type: "Corner Kicks", value: 8 },
        { type: "Yellow Cards", value: 3 },
        { type: "Ball Possession", value: "45%" },
        { type: "Total Shots", value: 9 }
      ] }
    ]
  };
}

const homeHistory = Array.from({ length: 5 }, (_, i) =>
  makeFixture(100001 + i, homeId, 300 + i, `2026-07-${String(31 - i).padStart(2, "0")}T12:00:00+00:00`, 2, i % 2)
);
const awayHistory = Array.from({ length: 5 }, (_, i) =>
  makeFixture(100101 + i, 400 + i, awayId, `2026-06-${String(30 - i).padStart(2, "0")}T12:00:00+00:00`, 1, 2)
);

const currentFixture = makeFixture(fixtureId, homeId, awayId, fixtureDate, null, null);
const allDetails = [currentFixture, ...homeHistory, ...awayHistory];
const originalFetch = globalThis.fetch;

globalThis.fetch = async url => {
  const u = new URL(url);

  // resolveFixture: id → ids → date
  if (u.pathname === "/fixtures" && u.searchParams.get("id") === String(fixtureId)) {
    return new Response(JSON.stringify({ response: [currentFixture] }), { status: 200 });
  }
  if (u.pathname === "/fixtures" && u.searchParams.get("ids") === String(fixtureId)) {
    return new Response(JSON.stringify({ response: [currentFixture] }), { status: 200 });
  }
  if (u.pathname === "/fixtures" && u.searchParams.get("team") === String(homeId)) {
    return new Response(JSON.stringify({ response: [currentFixture, ...homeHistory] }), { status: 200 });
  }
  if (u.pathname === "/fixtures" && u.searchParams.get("team") === String(awayId)) {
    return new Response(JSON.stringify({ response: [currentFixture, ...awayHistory] }), { status: 200 });
  }
  if (u.pathname === "/fixtures" && u.searchParams.get("ids")) {
    return new Response(JSON.stringify({ response: allDetails }), { status: 200 });
  }
  throw new Error(`Unexpected mock request: ${u.pathname}${u.search}`);
};

try {
  const result = await apiFootballHistory(String(fixtureId), { API_FOOTBALL_KEY: "MOCK_TOKEN" });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.provider, "api-football");
  assert.equal(result.body.history.home.sampleSize, 5);
  assert.equal(result.body.history.away.sampleSize, 5);
  assert.equal(result.body.diagnostic.currentFixtureExcluded, true);
  assert.equal(result.body.diagnostic.allHistoryBeforeFixture, true);
  assert.equal(result.body.greenScore.markets.length, 16);
  assert.equal(result.body.greenScore.oddsInfluence, false);
  assert.ok(result.body.greenScore.markets.some(m => m.market === "Escanteios Over 8.5"));
  assert.ok(result.body.greenScore.markets.some(m => m.market === "Cartões amarelos Over 3.5"));

  console.log("PASS test-api-football-history: fixture, histórico 5+5, exclusão do fixture atual, 16 mercados e odds=false.");
} finally {
  globalThis.fetch = originalFetch;
}

const missingKey = await apiFootballHistory(String(fixtureId), {});
assert.equal(missingKey.statusCode, 500);
assert.equal(missingKey.body.provider, "api-football");

console.log("PASS test-api-football-history: validação de API_FOOTBALL_KEY.");
