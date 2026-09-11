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
  return clamp(1 - poissonCdf(Math.floor(Number(threshold) || 0), lambda));
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
    const rows = Array.isArray(match?.statisticsNormalized) ? match.statisticsNormalized : [];
    for (const row of rows) {
      if (wanted.has(row?.category) && numeric(row?.value) != null) values.push(numeric(row.value));
    }
  }
  return values;
}

function combinedStatValues(homeHistory, awayHistory, categories) {
  return [...statValues(homeHistory, categories), ...statValues(awayHistory, categories)];
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function rate(values, predicate) {
  return values.length ? values.filter(predicate).length / values.length : null;
}

function consistency(values) {
  if (values.length < 2) return values.length ? 0.55 : 0;
  const avg = average(values) || 0;
  if (!avg) return 0.55;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / Math.max(Math.abs(avg), 1);
  return clamp(1 - cv / 1.5);
}

function empirical(values, predicate, fallback = 0.5) {
  const r = rate(values, predicate);
  return r == null ? fallback : r;
}

function confidenceScore(probability, sample, agreement, stability, uncertainty) {
  const p = clamp(probability);
  const sampleFactor = clamp(sample / 10);
  return clamp(100 * (
    0.50 * p +
    0.15 * sampleFactor +
    0.15 * clamp(agreement) +
    0.12 * clamp(stability) +
    0.08 * (1 - clamp(uncertainty))
  ), 0, 100);
}

function buildMarket(market, probability, observations, modelProbability = probability) {
  const p = clamp(probability);
  const values = Array.isArray(observations) ? observations : [];
  const agreement = clamp(1 - Math.abs(clamp(modelProbability) - p));
  const stability = consistency(values);
  const uncertainty = values.length ? clamp(1 / Math.sqrt(values.length)) : 1;
  const score = confidenceScore(p, values.length, agreement, stability, uncertainty);
  return {
    market,
    probability: round(p),
    score: round(score, 1),
    confidenceScore: round(score, 1),
    sample: values.length,
    agreement: round(agreement * 100, 1),
    stability: round(stability * 100, 1),
    uncertainty: round(uncertainty * 100, 1),
    fairOdd: p > 0 ? round(1 / p, 2) : null,
    oddsInfluence: false
  };
}

export function normalizeGreenScoreOutput(score = {}) {
  const markets = Array.isArray(score.markets)
    ? score.markets.map(market => ({
        ...market,
        probability: numeric(market?.probability) ?? 0,
        score: numeric(market?.score ?? market?.confidenceScore) ?? 0,
        confidenceScore: numeric(market?.confidenceScore ?? market?.score) ?? 0,
        oddsInfluence: false
      }))
    : [];
  const ranking = [...markets].sort((a, b) => Number(b.confidenceScore) - Number(a.confidenceScore));
  const top = ranking[0] || null;
  const second = ranking[1] || null;
  const scoreGap = top && second ? Number(top.confidenceScore) - Number(second.confidenceScore) : 0;
  const recommendedMarket = top && top.confidenceScore >= 70 && top.probability >= 0.70 && scoreGap >= 3
    ? top.market
    : null;
  return {
    ...score,
    markets: ranking,
    ranking,
    recommendedMarket,
    confidenceScore: top?.confidenceScore ?? 0,
    probability: top?.probability ?? 0,
    scoreGap: round(scoreGap, 1),
    oddsInfluence: false,
    confidenceMethod: "sample + consistency + agreement + stability + uncertainty"
  };
}

export function calculateGreenScore(homeHistory = {}, awayHistory = {}, homeVenueMatches = [], awayVenueMatches = []) {
  const homeMatches = allMatches(homeHistory);
  const awayMatches = allMatches(awayHistory);
  const allMatchesCombined = [...homeMatches, ...awayMatches];
  const sample = allMatchesCombined.length;
  const homeGoalsFor = homeMatches.map(m => Number(m.goalsFor || 0));
  const homeGoalsAgainst = homeMatches.map(m => Number(m.goalsAgainst || 0));
  const awayGoalsFor = awayMatches.map(m => Number(m.goalsFor || 0));
  const awayGoalsAgainst = awayMatches.map(m => Number(m.goalsAgainst || 0));
  const allGoals = allMatchesCombined.map(m => Number(m.goalsFor || 0) + Number(m.goalsAgainst || 0));

  const lambdaHome = Math.max(0.05, ((average(homeGoalsFor) ?? 1) + (average(awayGoalsAgainst) ?? 1)) / 2);
  const lambdaAway = Math.max(0.05, ((average(awayGoalsFor) ?? 1) + (average(homeGoalsAgainst) ?? 1)) / 2);
  const lambdaTotal = lambdaHome + lambdaAway;

  const markets = [
    buildMarket("Mais de 1.5 gols", poissonOver(1.5, lambdaTotal), allGoals),
    buildMarket("Mais de 2.5 gols", poissonOver(2.5, lambdaTotal), allGoals),
    buildMarket("Menos de 2.5 gols", 1 - poissonOver(2.5, lambdaTotal), allGoals),
    buildMarket("Menos de 3.5 gols", 1 - poissonOver(3.5, lambdaTotal), allGoals)
  ];

  const bttsObservations = allMatchesCombined.map(m => Number(m.goalsFor || 0) > 0 && Number(m.goalsAgainst || 0) > 0);
  const btts = empirical(bttsObservations, Boolean, 0.5);
  markets.push(
    buildMarket("Ambas marcam", btts, bttsObservations.map(Boolean)),
    buildMarket("Ambas não marcam", 1 - btts, bttsObservations.map(Boolean))
  );

  const homeDcMatches = (Array.isArray(homeVenueMatches) && homeVenueMatches.length ? homeVenueMatches : homeMatches);
  const awayDcMatches = (Array.isArray(awayVenueMatches) && awayVenueMatches.length ? awayVenueMatches : awayMatches);
  const homeDc = empirical(homeDcMatches, m => ["W", "D"].includes(m?.result), 0.5);
  const awayDc = empirical(awayDcMatches, m => ["W", "D"].includes(m?.result), 0.5);
  markets.push(
    buildMarket("Casa +0.5", homeDc, homeDcMatches.map(m => ["W", "D"].includes(m?.result))),
    buildMarket("Fora +0.5", awayDc, awayDcMatches.map(m => ["W", "D"].includes(m?.result)))
  );

  const corners = combinedStatValues(homeHistory, awayHistory, ["corners"]);
  const cornerAvg = average(corners) ?? 9;
  markets.push(
    buildMarket("Escanteios Over 7.5", empirical(corners, v => v >= 8, 0.5), corners, poissonOver(7.5, cornerAvg)),
    buildMarket("Escanteios Over 8.5", empirical(corners, v => v >= 9, 0.5), corners, poissonOver(8.5, cornerAvg)),
    buildMarket("Escanteios Over 10.5", empirical(corners, v => v >= 11, 0.5), corners, poissonOver(10.5, cornerAvg)),
    buildMarket("Escanteios Under 12.5", empirical(corners, v => v <= 12, 0.5), corners, 1 - poissonOver(12.5, cornerAvg))
  );

  const yellow = combinedStatValues(homeHistory, awayHistory, ["yellowCards"]);
  const yellowAvg = average(yellow) ?? 4;
  markets.push(
    buildMarket("Cartões amarelos Over 2.5", empirical(yellow, v => v >= 3, 0.5), yellow, poissonOver(2.5, yellowAvg)),
    buildMarket("Cartões amarelos Over 3.5", empirical(yellow, v => v >= 4, 0.5), yellow, poissonOver(3.5, yellowAvg)),
    buildMarket("Cartões amarelos Over 4.5", empirical(yellow, v => v >= 5, 0.5), yellow, poissonOver(4.5, yellowAvg)),
    buildMarket("Cartões amarelos Under 6.5", empirical(yellow, v => v <= 6, 0.5), yellow, 1 - poissonOver(6.5, yellowAvg))
  );

  return normalizeGreenScoreOutput({
    markets,
    samplePerTeam: { home: homeMatches.length, away: awayMatches.length },
    venueSamples: { home: homeVenueMatches.length, away: awayVenueMatches.length },
    source: "API-Football",
    provider: "api-football",
    oddsInfluence: false
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
