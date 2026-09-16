import assert from "node:assert/strict";
import { calculateGreenScore, historyCore } from "../cloudflare/history-core.js";

// historyCore legado foi removido — deve sinalizar 501 e apontar para apiFootballHistory.
const legacy = await historyCore();
assert.equal(legacy.statusCode, 501);
assert.equal(legacy.body.ok, false);
assert.match(String(legacy.body.error || ""), /apiFootballHistory/i);

// Amostra insuficiente: o motor ainda calcula, mas com sample baixo (confidence cai).
const thinHome = {
  matches: [
    { id: 1, goalsFor: 1, goalsAgainst: 0, result: "W", statisticsNormalized: [{ category: "corners", value: 8 }, { category: "yellowCards", value: 3 }] }
  ],
  sampleSize: 1
};
const thinAway = {
  matches: [
    { id: 2, goalsFor: 0, goalsAgainst: 2, result: "L", statisticsNormalized: [{ category: "corners", value: 7 }, { category: "yellowCards", value: 4 }] }
  ],
  sampleSize: 1
};

const score = calculateGreenScore(thinHome, thinAway, thinHome.matches, thinAway.matches);
assert.equal(score.markets.length, 16);
assert.equal(score.samplePerTeam.home, 1);
assert.equal(score.samplePerTeam.away, 1);
// Com amostra = 1 o fator de sample (sample/10) limita a confidence; a média deve ficar abaixo de amostra cheia.
const avgConf = score.markets.reduce((s, m) => s + Number(m.confidenceScore || 0), 0) / score.markets.length;
assert.ok(avgConf < 85, `confidence média com amostra fina deve ser moderada (got ${avgConf})`);
assert.equal(score.oddsInfluence, false);
assert.equal(score.recommendedMarket, null); // thresholds exigem conf>=70, prob>=0.7 e gap>=3 — amostra fina raramente recomenda

console.log("\n✅ test-history-insufficient-history: legado 501 + amostra fina validados.");
