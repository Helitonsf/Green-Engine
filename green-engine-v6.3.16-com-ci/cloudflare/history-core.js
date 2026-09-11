const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));

function poissonCdf(k, lambda) {
  const n = Math.max(0, Math.floor(k));
  const l = Math.max(0, Number(lambda) || 0);
  let term = Math.exp(-l);
  let sum = term;
  for (let i = 1; i <= n; i++) {
    term *= l / i;
    sum += term;
  }
  return clamp(sum);
}

function poissonOver(threshold, lambda) {
  const line = Number(threshold) || 0;
  return clamp(1 - poissonCdf(Math.floor(line), lambda));
}

function numeric(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function allMatches(history) {
  return Array.isArray(history?.matches) ? history.matches : [];
}

function statValues(history, categories) {
  const wanted = new Set(categories);
  const values = [];
  for (const match of allMatches(history)) {
    const rows = Array.isArray(match?.statisticsNormalized)
      ? match.statisticsNormalized
      : [];
    for (const row of rows) {
      if (wanted.has(row?.category) && numeric(row?.value) != null) values.push(numeric(row.value));
    }
  }
  return values;
}

function combinedStatValues(homeHistory, awayHistory, categories) {
  return [
    ...statValues(homeHistory, categories),
    ...statValues(awayHistory, categories)
  ];
}

function rate(values, predicate) {
  return values.length ? values.filter(predicate).length / values.length : null;
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function consistency(values) {
  if (values.length < 2) return values.length ? 0.55 : 0;
  const avg = average(values) || 0;
  if (!avg) return 0.55;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / Math.max(Math.abs(avg), 1);
  return clamp(1 - cv / 1.5, 0, 1);
}

function empirical(values, predicate, fallback = 0.5) {
  const r = rate(values, predicate);
  return r == null ? fallback : r;
}

function goalsTotalMatches(homeHistory, awayHistory) {
  const home = allMatches(homeHistory);
  const away = allMatches(awayHistory);
  return [...home, ...away].map(match => Number(match.goalsFor || 0) + Number(match.goalsAgainst || 0));
}

function marketResult(probability, sample, agreement, stability, uncertainty) {
  const p = clamp(probability);
  const sampleFactor = clamp(sample / 10);
  const score = clamp(
    100 * (
      0.50 * p +
      0.15 * sampleFactor +
      0.15 * agreement +
      0.12 * stability +
      0.08 * (1 - uncertainty)
    ),
    0,
    100
  );
  return {
    probability: round(p * 100, 2),
    score: round(score, 1),
    confidenceScore: round(score, 1),
    sample,
    agreement: round(agreement * 100, 1),
    stability: round(stability * 100, 1),
    uncertainty: round(uncertainty * 100, 1),
    oddsInfluence: false
  };
}

function buildMarket(market, probability, values, sample, modelProbability = probability) {
  const empiricalProbability = clamp(probability);
  const agreement = clamp(1 - Math.abs(clamp(modelProbability) - empiricalProbability));
  const stability = consistency(values);
  const uncertainty = values.length ? clamp(1 / Math.sqrt(values.length)) : 1;
  return {
    market,
    ...marketResult(empiricalProbability, sample, agreement, stability, uncertainty),
    fairOdd: empiricalProbability > 0 ? round(1 / empiricalProbability, 2) : null
  };
}

function normalizeGreenScoreOutput(score) {
  const markets = Array.isArray(score?.markets)
    ? score.markets.map(market => ({
        ...market,
        probability: numeric(market?.probability) ?? 0,
        score: numeric(market?.score ?? market?.confidenceScore) ?? 0,
        confidenceScore: numeric(market?.confidenceScore ?? market?.score) ?? 0,
        oddsInfluence: false
      }))
    : [];
  const ranked = [...markets].sort((a, b) => Number(b.confidenceScore) - Number(a.confidenceScore));
  const top = ranked[0] || null;
  const second = ranked[1] || null;
  const gap = top && second ? Number(top.confidenceScore) - Number(second.confidenceScore) : 0;
  const recommended = top && top.confidenceScore >= 70 && top.probability >= 70 && gap >= 3 ? top.market : null;
  return {
    ...score,
    markets: ranked,
    ranking: ranked,
    recommendedMarket: recommended,
    confidenceScore: top ? top.confidenceScore : 0,
    probability: top ? top.probability : 0,
    scoreGap: round(gap, 1),
    oddsInfluence: false,
    confidenceMethod: "sample + consistency + agreement + stability + uncertainty"
  };
}

export function calculateGreenScore(homeHistory = {}, awayHistory = {}, homeVenueMatches = [], awayVenueMatches = []) {
  const homeMatches = allMatches(homeHistory);
  const awayMatches = allMatches(awayHistory);
  const allGoals = goalsTotalMatches(homeHistory, awayHistory);
  const sample = homeMatches.length + awayMatches.length;
  const homeGoalsFor = homeMatches.map(m => Number(m.goalsFor || 0));
  const homeGoalsAgainst = homeMatches.map(m => Number(m.goalsAgainst || 0));
  const awayGoalsFor = awayMatches.map(m => Number(m.goalsFor || 0));
  const awayGoalsAgainst = awayMatches.map(m => Number(m.goalsAgainst || 0));

  const lambdaHome = Math.max(0.05, ((average(homeGoalsFor) ?? 1) + (average(awayGoalsAgainst) ?? 1)) / 2);
  const lambdaAway = Math.max(0.05, ((average(awayGoalsFor) ?? 1) + (average(homeGoalsAgainst) ?? 1)) / 2);
  const lambdaTotal = lambdaHome + lambdaAway;

  const goals = [
    buildMarket("Mais de 1.5 gols", poissonOver(1.5, lambdaTotal), allGoals, sample, poissonOver(1.5, lambdaTotal)),
    buildMarket("Mais de 2.5 gols", poissonOver(2.5, lambdaTotal), allGoals, sample, poissonOver(2.5, lambdaTotal)),
    buildMarket("Menos de 2.5 gols", 1 - poissonOver(2.5, lambdaTotal), allGoals, sample, 1 - poissonOver(2.5, lambdaTotal)),
    buildMarket("Menos de 3.5 gols", 1 - poissonOver(3.5, lambdaTotal), allGoals, sample, 1 - poissonOver(3.5, lambdaTotal))
  ];

  const bttsValues = [...homeMatches, ...awayMatches].map(m => [Number(m.goalsFor || 0), Number(m.goalsAgainst || 0)]);
  const btts = empirical(bttsValues, pair => pair[0] > 0 && pair[1] > 0, 0.5);
  const bttsNo = 1 - btts;
  const bttsMarkets = [
    buildMarket("Ambas marcam", btts, bttsValues.map(v => v[0] + v[1]), sample, btts),
    buildMarket("Ambas não marcam", bttsNo, bttsValues.map(v => v[0] + v[1]), sample, bttsNo)
  ];

  const homePlus = empirical(homeGoalsFor, value => value >= 0, 1);
  const awayPlus = empirical(awayGoalsFor, value => value >= 0, 1);
  const doubleChance = [
    buildMarket("Casa +0.5", homePlus, homeGoalsFor, homeMatches.length, homePlus),
    buildMarket("Fora +0.5", awayPlus, awayGoalsFor, awayMatches.length, awayPlus)
  ];

  const corners = combinedStatValues(homeHistory, awayHistory, ["corners"]);
  const cornerMarkets = [
    buildMarket("Escanteios Over 7.5", empirical(corners, v => v >= 8, 0.5), corners, corners.length, poissonOver(7.5, average(corners) ?? 9)),
    buildMarket("Escanteios Over 8.5", empirical(corners, v => v >= 9, 0.5), corners, corners.length, poissonOver(8.5, average(corners) ?? 9)),
    buildMarket("Escanteios Over 10.5", empirical(corners, v => v >= 11, 0.5), corners, corners.length, poissonOver(10.5, average(corners) ?? 9)),
    buildMarket("Escanteios Under 12.5", empirical(corners, v => v <= 12, 0.5), corners, corners.length, 1 - poissonOver(12.5, average(corners) ?? 9))
  ];

  const yellow = combinedStatValues(homeHistory, awayHistory, ["yellowCards"]);
  const yellowMarkets = [
    buildMarket("Cartões amarelos Over 2.5", empirical(yellow, v => v >= 3, 0.5), yellow, yellow.length, poissonOver(2.5, average(yellow) ?? 4)),
    buildMarket("Cartões amarelos Over 3.5", empirical(yellow, v => v >= 4, 0.5), yellow, yellow.length, poissonOver(3.5, average(yellow) ?? 4)),
    buildMarket("Cartões amarelos Over 4.5", empirical(yellow, v => v >= 5, 0.5), yellow, yellow.length, poissonOver(4.5, average(yellow) ?? 4)),
    buildMarket("Cartões amarelos Under 6.5", empirical(yellow, v => v <= 6, 0.5), yellow, yellow.length, 1 - poissonOver(6.5, average(yellow) ?? 4))
  ];

  const markets = [...goals, ...bttsMarkets, ...doubleChance, ...cornerMarkets, ...yellowMarkets];
  return normalizeGreenScoreOutput({
    markets,
    samplePerTeam: { home: homeMatches.length, away: awayMatches.length },
    venueSamples: { home: homeVenueMatches.length, away: awayVenueMatches.length },
    oddsInfluence: false,
    source: "API-Football",
    provider: "api-football"
  });
}

export function normalizeHistoryOutput(history = {}) {
  return {
    teamId: numeric(history.teamId),
    sampleSize: Array.isArray(history.matches) ? history.matches.length : 0,
    matches: Array.isArray(history.matches) ? history.matches : [],
    form: history.form || null,
    wins: numeric(history.wins) ?? 0,
    draws: numeric(history.draws) ?? 0,
    losses: numeric(history.losses) ?? 0,
    goalsFor: numeric(history.goalsFor) ?? 0,
    goalsAgainst: numeric(history.goalsAgainst) ?? 0,
    avgGoalsFor: numeric(history.avgGoalsFor) ?? 0,
    avgGoalsAgainst: numeric(history.avgGoalsAgainst) ?? 0,
    avgTotalGoals: numeric(history.avgTotalGoals) ?? 0
  };
}

export async function historyCore() {
  return {
    statusCode: 501,
    body: {
      ok: false,
      version: "6.3.16",
      provider: "api-football",
      error: "historyCore legado removido: use apiFootballHistory()."
    }
  };
}
