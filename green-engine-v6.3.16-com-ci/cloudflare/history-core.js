export async function historyCore(id, token) {
  const json = (statusCode, body) => ({
    statusCode,
    body
  });

  const limit = 5;



  if (!token) return json(500, { error: "SPORTMONKS_API_TOKEN não está configurado no Cloudflare." });
  if (!id || !/^\d+$/.test(id)) return json(400, { error: "Informe um fixture ID numérico em ?fixture=ID." });

  try {
    const base = await sm(`/v3/football/fixtures/${id}?include=participants;league;state;scores`, token);

    if (!base.ok || !base.data?.data) {
  const status =
    base.ok && !base.data?.data
      ? 404
      : (base.status >= 400 ? base.status : 502);

  const timedOut = base.status === 504;

  return json(status, {
    ok: false,
    version: "6.3.16",
    error: timedOut
      ? "Tempo limite excedido ao consultar a SportMonks."
      : "Fixture não encontrado ou não disponível",
    upstreamStatus: base.status,
    details: safeDetails(base.data)
  });
}

    const f = base.data.data;
    const participants = Array.isArray(f.participants) ? f.participants : [];
    const home = participants.find(p => p.meta?.location === "home");
    const away = participants.find(p => p.meta?.location === "away");

    if (!home || !away) {
      return json(422, { error: "Fixture sem participantes home/away." });
    }

    const baseFixtureContext = {
      id: Number(f.id),
      startingAt: f.starting_at || null
    };

    const homeFixtureContext = {
      ...baseFixtureContext,
      venue: "home"
    };

    const awayFixtureContext = {
      ...baseFixtureContext,
      venue: "away"
    };

    const [homeHistory, awayHistory] = await Promise.all([
      teamHistory(home.id, limit, token, homeFixtureContext),
      teamHistory(away.id, limit, token, awayFixtureContext)
    ]);

    /*
     * v6.3.15-CF.1
     *
     * As amostras casa/fora agora são derivadas dos mesmos matches
     * já coletados por teamHistory().
     *
     * Não realizar novas chamadas ao SportMonks para venue.
     */
    const homeVenueMatches = Array.isArray(homeHistory._venueMatches)
      ? homeHistory._venueMatches.slice(0, limit)
      : [];

    const awayVenueMatches = Array.isArray(awayHistory._venueMatches)
      ? awayHistory._venueMatches.slice(0, limit)
      : [];

    console.log("=== PHASE 65.8.123 VENUE FROM SINGLE COLLECTION ===");
    console.log("HOME VENUE COUNT:", homeVenueMatches.length);
    console.log("AWAY VENUE COUNT:", awayVenueMatches.length);

    if (homeHistory.matches.length < limit || awayHistory.matches.length < limit) {
      return json(422, {
        ok: false,
        version: "6.3.16",
    error: "Histórico insuficiente com placares válidos para a amostra solicitada.",
        diagnostic: {
          fixtureRequestOk: true,
          currentFixtureExcluded: true,
          homeHistoryCount: homeHistory.matches.length,
          awayHistoryCount: awayHistory.matches.length,
          requiredPerTeam: limit
        }
      });
    }

    const score = calculateGreenScore(
      homeHistory,
      awayHistory,
      homeVenueMatches,
      awayVenueMatches
    );

    // v6.3.3: enforce one canonical JSON contract at the final boundary.
    // This prevents legacy Portuguese field names from leaking into the API,
    // even if upstream data or an older helper shape is returned.
    const normalizedHome = normalizeHistoryOutput(homeHistory);
    const normalizedAway = normalizeHistoryOutput(awayHistory);
    const normalizedScore = normalizeGreenScoreOutput(score);

    return json(200, {
      ok: true,
      version: "6.3.16",
      fixture: {
        id: f.id,
        name: f.name || `${home.name} — ${away.name}`,
        starting_at: f.starting_at || null,
        league: f.league?.name || null,
        state: f.state?.name || null,
        home: { id: home.id, name: home.name },
        away: { id: away.id, name: away.name }
      },
      history: { home: normalizedHome, away: normalizedAway },
      greenScore: normalizedScore,
      diagnostic: {
        fixtureRequestOk: true,
        currentFixtureExcluded: !homeHistory.matches.some(m => Number(m.id) === Number(f.id))
          && !awayHistory.matches.some(m => Number(m.id) === Number(f.id)),
        homeHistoryCount: homeHistory.matches.length,
        awayHistoryCount: awayHistory.matches.length,
        homeVenueCount: homeVenueMatches.length,
        awayVenueCount: awayVenueMatches.length,
        homeVenueCorrect: homeVenueMatches.every(m => m.venue === "home"),
        awayVenueCorrect: awayVenueMatches.every(m => m.venue === "away"),
        homeVenueRequired: limit,
        awayVenueRequired: limit,
        allHistoryBeforeFixture: [
          ...homeHistory.matches,
          ...awayHistory.matches,
          ...homeVenueMatches,
          ...awayVenueMatches
        ].every(m => isBeforeFixture(m.starting_at, f.starting_at, f.id, m.id))
      }
    });
  } catch (e) {
    return json(502, { error: "Falha no backend.", details: e.message });
  }
};

/**
 * Obtém somente os jogos anteriores ao fixture analisado.
 * O fixture atual é excluído por ID e por data/hora.
 * Os placares são enriquecidos por consulta detalhada ao fixture para
 * garantir leitura correta do objeto scores do SportMonks.
 */

async function teamHistory(teamId, limit, token, fixtureContext) {
  const candidateMap = new Map();

  /*
   * v6.3.15-CF.2
   *
   * Substitui teams/{teamId}?include=latest por fixtures/between.
   * O endpoint between fornece participants/scores quando solicitado
   * e possui limite máximo de 100 dias por consulta.
   */
  const collectionLimit = Math.max(limit * 3, 15);
  const MAX_PAGES_PER_WINDOW = 2;
  const MAX_WINDOWS = 8;

  const fixtureDate =
    fixtureContext.startingAt
      ? fixtureContext.startingAt.slice(0, 10)
      : new Date().toISOString().slice(0, 10);

  async function collectBetween(startDate, endDate) {
    let page = 1;
    let hasMore = true;

    while (hasMore && candidateMap.size < collectionLimit && page <= MAX_PAGES_PER_WINDOW) {
      const path =
        "/v3/football/fixtures/between/" +
        startDate +
        "/" +
        endDate +
        "?include=participants;scores;state;statistics&per_page=100&page=" +
        page;

      const r = await sm(path, token);

      if (!r.ok || !Array.isArray(r.data?.data)) {
        console.log("BETWEEN FETCH FAILED:", {
          teamId,
          startDate,
          endDate,
          page,
          status: r.status,
          details: safeDetails(r.data)
        });
        break;
      }

      const fixtures = r.data.data;

      for (const fixture of fixtures) {
        if (!fixture || !Number(fixture.id)) continue;

        const participants = Array.isArray(fixture.participants)
          ? fixture.participants
          : [];

        const belongsToTeam = participants.some(
          p => Number(p?.id) === Number(teamId)
        );

        if (!belongsToTeam) continue;

        addCandidates(
          candidateMap,
          [fixture],
          teamId,
          fixtureContext
        );
      }

      const pagination = r.data.pagination || {};

      hasMore =
        pagination.has_more === true &&
        Boolean(pagination.next_page);

      page += 1;
    }
  }

  /*
   * Primeira janela: últimos 100 dias.
   */
  const latestWindowStart = subtractDays(fixtureDate, 99);

  let windowsUsed = 0;

      await collectBetween(
    latestWindowStart,
    fixtureDate


  );

  windowsUsed++;

  let matches = await resolveValidMatches(
    Array.from(candidateMap.values()),
    teamId,
    collectionLimit,
    token,
    fixtureContext
  );

  let generalMatches = matches.slice(0, limit);

  const requiredVenue =
    fixtureContext.venue === "home"
      ? "home"
      : fixtureContext.venue === "away"
        ? "away"
        : null;

  console.log("REQUIRED VENUE:", requiredVenue);

  /*
   * Se necessário, percorre janelas anteriores de até 100 dias,
   * respeitando o limite de 730 dias.
   */
  if (
    generalMatches.length < limit ||
    matches.length < collectionLimit
  ) {
    const minimumStartDate =
      subtractDays(fixtureDate, 730);

    let windowEnd =
      subtractDays(latestWindowStart, 1);

    while (
      windowEnd >= minimumStartDate &&
      windowsUsed < MAX_WINDOWS &&
      (
        generalMatches.length < limit ||
        matches.length < collectionLimit
      )
    ) {
      const rawWindowStart =
        subtractDays(windowEnd, 99);

      const windowStart =
        rawWindowStart < minimumStartDate
          ? minimumStartDate
          : rawWindowStart;

      await collectBetween(
        windowStart,
        windowEnd
      );

      windowsUsed++;

      matches = await resolveValidMatches(
        Array.from(candidateMap.values()),
        teamId,
        collectionLimit,
        token,
        fixtureContext
      );

      generalMatches = matches.slice(0, limit);

      windowEnd =
        subtractDays(windowStart, 1);
    }
  }

  const venueMatches = requiredVenue
    ? matches
        .filter(
          m => m && m.venue === requiredVenue
        )
        .slice(0, limit)
    : [];

  const summary = summarizeHistory(
    teamId,
    generalMatches
  );

  summary._venueMatches = venueMatches;
  summary._requiredVenue = requiredVenue;

  console.log(
    "GENERAL SAMPLE:",
    generalMatches.length
  );

  console.log(
    "VENUE SAMPLE:",
    venueMatches.length
  );

  console.log(
    "VENUE:",
    requiredVenue
  );

  return summary;
}

async function resolveValidMatches(candidates, teamId, limit, token, fixtureContext) {
  console.log("=== CORE DEBUG resolveValidMatches OPTIMIZED ===");
  console.log("TEAM:", teamId);
  console.log("INPUT CANDIDATES:", Array.from(candidates || []).length);
  console.log("FIXTURE:", fixtureContext);

  const allCandidates = Array.from(candidates || []);

  const sortedCandidates = allCandidates
    .filter(f => f && Number(f.id))
    .filter(f => isBeforeFixture(
      f.starting_at,
      fixtureContext.startingAt,
      fixtureContext.id,
      f.id
    ))
    .sort((a, b) =>
      new Date(b.starting_at || 0) - new Date(a.starting_at || 0)
    );

  console.log("SORTED CANDIDATES:", sortedCandidates.length);

  const valid = [];

  for (const f of sortedCandidates) {
    if (valid.length >= limit) break;

    let candidate = f;

    const hasParticipants =
      Array.isArray(candidate.participants) &&
      candidate.participants.length > 0;

    const hasScores =
      Array.isArray(candidate.scores) &&
      candidate.scores.length > 0;

    /*
     * v6.3.15-CF.3 — evitar subrequests individuais
     *
     * fixtures/between já é solicitado com participants;scores;state.
     * Não fazer fallback para fixtures/{id} aqui, pois cada chamada
     * adicional consome um subrequest do Worker.
     *
     * Candidatos sem dados suficientes são simplesmente ignorados.
     */
    if (!hasParticipants || !hasScores) {
      console.log("SKIPPING INCOMPLETE CANDIDATE:", candidate.id, {
        hasParticipants,
        hasScores
      });
      continue;
    }

    console.log("USING CANDIDATE DIRECTLY:", candidate.id);

    if (!candidate) continue;

    if (Number(candidate.id) === Number(fixtureContext.id)) {
      continue;
    }

    const m = normalizeMatch(candidate, teamId);

    console.log("NORMALIZED:", JSON.stringify({
      id: m.id,
      venue: m.venue,
      result: m.result,
      goalsFor: m.goalsFor,
      goalsAgainst: m.goalsAgainst,
      score: m.score,
      scoreSource: m.scoreSource,
      scoreAvailable: m.scoreAvailable
    }));

    if (m.scoreAvailable) {
      valid.push(m);
    }
  }

  const finalMatches = valid
    .sort((a, b) =>
      new Date(b.starting_at || 0) - new Date(a.starting_at || 0)
    )
    .slice(0, limit);

  console.log("VALID SCORES:", valid.length);
  console.log("FINAL MATCH COUNT:", finalMatches.length);
  console.log("FINAL MATCH IDS:", finalMatches.map(m => m.id));

  return finalMatches;
}

function addCandidates(map, fixtures, teamId, fixtureContext) {
  console.log("=== CORE DEBUG addCandidates ===");
  console.log("TEAM:", teamId);
  console.log("FIXTURES RECEIVED:", Array.isArray(fixtures) ? fixtures.length : "NOT_ARRAY");
  console.log("MAP BEFORE:", map.size);
  console.log("FIXTURE CONTEXT:", fixtureContext);

  for (const f of fixtures || []) {
    const basic = {
      id: f?.id,
      starting_at: f?.starting_at,
      participants: Array.isArray(f?.participants)
        ? f.participants.map(p => ({
            id: p?.id,
            location: p?.meta?.location
          }))
        : null
    };

    console.log("CHECK CANDIDATE:", JSON.stringify(basic));

    if (!f || !Number(f.id)) {
      console.log("DISCARD: INVALID ID");
      continue;
    }

    if (Number(f.id) === Number(fixtureContext.id)) {
      console.log("DISCARD: CURRENT FIXTURE");
      continue;
    }

    const before = isBeforeFixture(
      f.starting_at,
      fixtureContext.startingAt,
      fixtureContext.id,
      f.id
    );

    console.log("IS BEFORE:", before);

    if (!before) {
      console.log("DISCARD: DATE FILTER");
      continue;
    }

    const participants = Array.isArray(f.participants)
      ? f.participants
      : [];

    const belongsToTeam = participants.some(
      p => Number(p.id) === Number(teamId)
    );

    console.log("BELONGS TO TEAM:", belongsToTeam);

    if (participants.length && !belongsToTeam) {
      console.log("DISCARD: TEAM FILTER");
      continue;
    }

    map.set(Number(f.id), f);

    console.log("ACCEPTED:", f.id);
    console.log("MAP NOW:", map.size);
  }

  console.log("MAP AFTER:", map.size);
}

function classifyStatistics(statistics) { if (!Array.isArray(statistics)) return []; const typeMap = { 34: "corners", 45: "possession", 52: "goals", 79: "assists", 83: "redCards", 84: "yellowCards" }; return statistics.map(s => ({ typeId: Number(s?.type_id ?? 0) || null, category: typeMap[Number(s?.type_id)] ?? "unclassified", participantId: Number(s?.participant_id ?? 0) || null, location: s?.location ?? null, value: s?.data?.value ?? null })); }

function normalizeMatch(f, teamId) {
  const participants = Array.isArray(f.participants) ? f.participants : [];
  const home = participants.find(p => p.meta?.location === "home");
  const away = participants.find(p => p.meta?.location === "away");

  // Fallback por participant_id caso meta.location não esteja disponível.
  const teamParticipant = participants.find(p => Number(p.id) === Number(teamId));
  const isHome = home
    ? Number(home.id) === Number(teamId)
    : teamParticipant?.meta?.location === "home";

  const opponentParticipant = isHome ? away : home;
  const score = extractCurrentScore(f.scores, home?.id, away?.id);

  const homeGoals = score.home;
  const awayGoals = score.away;
  const scoreAvailable = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);

  return {
    id: Number(f.id),
    starting_at: f.starting_at || null,
    name: f.name || `${home?.name || "Casa"} — ${away?.name || "Fora"}`,
    venue: isHome ? "home" : "away",
    opponent: opponentParticipant?.name || null,
    result: scoreAvailable ? deriveResult(isHome, homeGoals, awayGoals) : null,
    goalsFor: scoreAvailable ? (isHome ? homeGoals : awayGoals) : null,
    goalsAgainst: scoreAvailable ? (isHome ? awayGoals : homeGoals) : null,
    score: {
      home: homeGoals,
      away: awayGoals
    },
    statistics: Array.isArray(f.statistics) ? f.statistics : [],
    statisticsNormalized: classifyStatistics(f.statistics),
    scoreSource: score.source,
    scoreAvailable
  };
}

/**
 * SportMonks normalmente retorna scores como itens independentes:
 * score: { goals: N, participant: "home"|"away" }
 * e description: "CURRENT".
 * Também aceitamos variantes home/away para manter compatibilidade.
 */
function extractCurrentScore(scores, homeId, awayId) {
  const list = Array.isArray(scores) ? scores : [];

  const current = list.filter(s =>
    String(s?.description || s?.type?.description || "")
      .toLowerCase()
      .includes("current")
  );

  const usable = current.length ? current : list;

  let homeGoals = null;
  let awayGoals = null;

  for (const item of usable) {
    const participant =
      item?.score?.participant ??
      item?.participant ??
      item?.score?.participant_type ??
      null;

    const goals = toGoalNumber(item?.score?.goals ?? item?.goals);

    if (goals === null) continue;

    const p = String(participant || "").toLowerCase();

    if (p === "home") homeGoals = goals;
    else if (p === "away") awayGoals = goals;
    else if (homeId && Number(item?.participant_id) === Number(homeId)) homeGoals = goals;
    else if (awayId && Number(item?.participant_id) === Number(awayId)) awayGoals = goals;

    // Compatibilidade com formatos que trazem o placar completo no mesmo objeto.
    if (homeGoals === null && toGoalNumber(item?.score?.home) !== null) {
      homeGoals = toGoalNumber(item.score.home);
    }
    if (awayGoals === null && toGoalNumber(item?.score?.away) !== null) {
      awayGoals = toGoalNumber(item.score.away);
    }
  }

  if (homeGoals !== null && awayGoals !== null) {
    return { home: homeGoals, away: awayGoals, source: "scores.current" };
  }

  // Último fallback: objeto score com goals + participant, mesmo sem CURRENT.
  for (const item of list) {
    const p = String(item?.score?.participant ?? item?.participant ?? "").toLowerCase();
    const goals = toGoalNumber(item?.score?.goals ?? item?.goals);
    if (goals === null) continue;

    if (p === "home") homeGoals = goals;
    if (p === "away") awayGoals = goals;
  }

  if (homeGoals !== null && awayGoals !== null) {
    return { home: homeGoals, away: awayGoals, source: "scores.participant" };
  }

  return {
    home: homeGoals,
    away: awayGoals,
    source: "score-unavailable"
  };
}

function summarizeHistory(teamId, matches) {
  const wins = matches.filter(m => m.result === "W").length;
  const draws = matches.filter(m => m.result === "D").length;
  const losses = matches.filter(m => m.result === "L").length;
  const gf = matches.reduce((s, m) => s + m.goalsFor, 0);
  const ga = matches.reduce((s, m) => s + m.goalsAgainst, 0);

  return {
    teamId,
    sampleSize: matches.length,
    matches,
    form: matches.map(m => m.result).join(""),
    wins, draws, losses,
    goalsFor: gf,
    goalsAgainst: ga,
    avgGoalsFor: avg(gf, matches.length),
    avgGoalsAgainst: avg(ga, matches.length),
    avgTotalGoals: avg(gf + ga, matches.length)
  };
}

function normalizeHistoryOutput(history) {
  const matches = Array.isArray(history?.matches) ? history.matches : [];

  const normalizedMatches = matches.map(m => ({
    id: Number(m.id),
    starting_at: m.starting_at ?? m.iniciando_em ?? null,
    name: m.name ?? m.nome ?? null,
    venue: m.venue ?? (m.local === "casa" ? "home" : m.local === "fora" ? "away" : null),
    opponent: m.opponent ?? m.adversário ?? null,
    result: m.result ?? m.resultado ?? null,
    goalsFor: m.goalsFor ?? m.golsMarcados ?? null,
    goalsAgainst: m.goalsAgainst ?? m.golsSofridos ?? null,
    score: {
      home: m.score?.home ?? m.placar?.casa ?? null,
      away: m.score?.away ?? m.placar?.fora ?? null
    },
    statistics: Array.isArray(m.statistics) ? m.statistics : [],
    statisticsNormalized: Array.isArray(m.statisticsNormalized) ? m.statisticsNormalized : [],
    scoreSource: m.scoreSource ?? m.fonteDoPlacar ?? "score-unavailable",
    scoreAvailable: Boolean(
      m.scoreAvailable ??
      m.placarDisponível ??
      (Number.isFinite(Number(m.goalsFor)) && Number.isFinite(Number(m.goalsAgainst)))
    )
  }));

  const wins = normalizedMatches.filter(m => m.result === "W").length;
  const draws = normalizedMatches.filter(m => m.result === "D").length;
  const losses = normalizedMatches.filter(m => m.result === "L").length;
  const goalsFor = normalizedMatches.reduce((s, m) => s + Number(m.goalsFor || 0), 0);
  const goalsAgainst = normalizedMatches.reduce((s, m) => s + Number(m.goalsAgainst || 0), 0);
  const sampleSize = normalizedMatches.length;

  return {
    teamId: Number(history?.teamId),
    sampleSize,
    matches: normalizedMatches,
    form: normalizedMatches.map(m => m.result || "").join(""),
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    avgGoalsFor: avg(goalsFor, sampleSize),
    avgGoalsAgainst: avg(goalsAgainst, sampleSize),
    avgTotalGoals: avg(goalsFor + goalsAgainst, sampleSize)
  };
}

function normalizeGreenScoreOutput(score) {
  const markets = Array.isArray(score?.markets) ? score.markets.map(m => ({
    market: m.market ?? null,
    probability: Number.isFinite(Number(m.probability)) ? Number(m.probability) : null,
    score: Number.isFinite(Number(m.score ?? m.confidenceScore))
      ? Number(m.score ?? m.confidenceScore)
      : null,
    confidenceScore: Number.isFinite(Number(m.confidenceScore ?? m.score))
      ? Number(m.confidenceScore ?? m.score)
      : null,
    confidence: m.confidence ?? null,
    components: m.components ?? null,
    reason: m.reason ?? m.motivo ?? ""
  })) : [];

  const ranking = Array.isArray(score?.ranking) ? score.ranking.map((m, i) => ({
    rank: Number(m.rank ?? i + 1),
    market: m.market ?? null,
    probability: Number.isFinite(Number(m.probability)) ? Number(m.probability) : null,
    score: Number.isFinite(Number(m.score ?? m.confidenceScore))
      ? Number(m.score ?? m.confidenceScore)
      : null
  })) : [];

  return {
    confidence: score?.confidence ?? score?.confiança ?? "insufficient-data",
    recommendedMarket: score?.recommendedMarket ?? null,
    markets,
    ranking,
    model: score?.model ?? null,
    explanation: score?.explanation ?? ""
  };
}

function calculateGreenScore(home, away, homeVenueMatches = [], awayVenueMatches = []) {
  const required = Math.min(home.sampleSize || 0, away.sampleSize || 0);

  if (required < 5) {
    return {
      confidence: "insufficient-data",
      recommendedMarket: null,
      markets: [],
      ranking: [],
      explanation: "São necessárias 5 partidas válidas por equipe para estimar os mercados."
    };
  }

  /*
   * v6.3.14 — Confidence & Market Ranking
   *
   * A probabilidade continua sendo específica de cada mercado.
   * O antigo "overall" foi removido: não existe mais uma média que misture
   * mercados opostos.
   *
   * Cada mercado recebe um Confidence Score próprio, calculado a partir de:
   * 1) tamanho da amostra;
   * 2) consistência histórica;
   * 3) concordância entre modelo e frequência observada;
   * 4) estabilidade da frequência (leave-one-out);
   * 5) margem de incerteza estatística.
   *
   * Odds NÃO entram em nenhuma etapa.
   * recommendedMarket é liberado quando atende aos critérios mínimos de segurança.
   */
  const lambdaHome = expectedGoals(
    home.avgGoalsFor, away.avgGoalsAgainst,
    home.avgTotalGoals, away.avgTotalGoals
  );
  const lambdaAway = expectedGoals(
    away.avgGoalsFor, home.avgGoalsAgainst,
    away.avgTotalGoals, home.avgTotalGoals
  );

  const matrix = poissonMatrix(lambdaHome, lambdaAway, 15);
  const empirical = empiricalMarketProbabilities(home, away);

  const marketInputs = [
    ["Over 1.5", poissonProbability(matrix, totalGoalsAtLeast(2)), empirical.over15, empirical.observations.over15],
    ["Over 2.5", poissonProbability(matrix, totalGoalsAtLeast(3)), empirical.over25, empirical.observations.over25],
    ["Under 2.5", poissonProbability(matrix, totalGoalsAtMost(2)), empirical.under25, empirical.observations.under25],
    ["Under 3.5", poissonProbability(matrix, totalGoalsAtMost(3)), empirical.under35, empirical.observations.under35],
    ["Ambas Marcam", poissonProbability(matrix, bothTeamsScore), empirical.bttsYes, empirical.observations.bttsYes],
    ["Ambas Marcam — Não", poissonProbability(matrix, bothTeamsDontScore), empirical.bttsNo, empirical.observations.bttsNo],
    ["Casa +0.5",
      poissonProbability(matrix, homeNotLose),
      ratio(
        homeVenueMatches.map(m => m.result === "W" || m.result === "D" ? 1 : 0),
        Boolean
      ),
      homeVenueMatches.map(m => m.result === "W" || m.result === "D" ? 1 : 0)
    ],
    ["Fora +0.5",
      poissonProbability(matrix, awayNotLose),
      ratio(
        awayVenueMatches.map(m => m.result === "W" || m.result === "D" ? 1 : 0),
        Boolean
      ),
      awayVenueMatches.map(m => m.result === "W" || m.result === "D" ? 1 : 0)
    ]
  ];

  const markets = marketInputs.map(([name, modelProbability, empiricalProbability, observations]) =>
    confidenceMarket(name, modelProbability, empiricalProbability, observations, required)
  );

  // O ranking é exclusivamente por Confidence Score.
  // A probabilidade continua disponível, mas não é usada como substituto
  // da confiança estatística.
  markets.sort((a, b) =>
    b.score - a.score ||
    b.probability - a.probability ||
    a.market.localeCompare(b.market)
  );

  console.log("=== PHASE 65.8.27 MARKET MAP ===");
  for (const m of markets) {
    console.log(JSON.stringify({
      market: m.market,
      probability: m.probability,
      score: m.score,
      confidenceScore: m.confidenceScore,
      modelProbability: m.modelProbability,
      empiricalProbability: m.empiricalProbability,
      observations: m.observations
    }));
  }

  const ranking = markets.map((m, index) => ({
    rank: index + 1,
    market: m.market,
    probability: m.probability,
    score: m.score
  }));

  console.log("=== PHASE 65.8.26 FINAL MARKET AUDIT ===");
  console.log("LAMBDA HOME:", lambdaHome);
  console.log("LAMBDA AWAY:", lambdaAway);
  console.log("MARKETS FINAL:", JSON.stringify(markets, null, 2));
  console.log("RANKING FINAL:", JSON.stringify(ranking, null, 2));

  const topMarket = ranking[0] || null;
  const secondMarket = ranking[1] || null;

  const recommendedMarket =
    topMarket &&
    topMarket.rank === 1 &&
    Number.isFinite(topMarket.score) &&
    topMarket.score >= 70 &&
    Number.isFinite(topMarket.probability) &&
    topMarket.probability >= 0.70 &&
    (!secondMarket || (
      topMarket.score !== secondMarket.score &&
      topMarket.score - secondMarket.score >= 3
    ))
      ? topMarket.market
      : null;

  return {
    confidence: "validation-only",
    recommendedMarket,
    markets,
    ranking,
    model: {
      method: "poisson+empirical-blend",
      confidenceMethod: "sample+consistency+agreement+stability+uncertainty",
      lambdaHome: round(lambdaHome, 3),
      lambdaAway: round(lambdaAway, 3),
      samplePerTeam: required,
      oddsInfluence: false
    },
    explanation:
      "v6.3.14 elimina o overall como média dos mercados. Cada mercado possui " +
      "probabilidade e Confidence Score próprios. O Confidence Score considera " +
      "tamanho da amostra, consistência histórica, concordância entre modelo e " +
      "frequência, estabilidade da estimativa e margem de incerteza. O ranking " +
      "é ordenado pelo Confidence Score. Odds não influenciam o cálculo e " +
      "recommendedMarket é liberado quando atende aos critérios mínimos de segurança."
  };
}

function confidenceMarket(name, modelProbability, empiricalProbability, observations, samplePerTeam) {
  const model = clamp(modelProbability, 0, 1);
  const empirical = clamp(empiricalProbability, 0, 1);
  const observationsSafe = Array.isArray(observations) ? observations.filter(Number.isFinite) : [];
  const n = observationsSafe.length;

  // Para mercados de gols/BTTS, n normalmente é 10 (5 + 5).
  // Para Casa/Fora +0.5, n corresponde apenas aos jogos da equipe no mesmo papel do mercado (casa ou fora), podendo ser menor que 5.
  const sampleFactor = Math.min(1, Math.sqrt(Math.max(n, 1) / 10));

  // Extremidade histórica: 0 no equilíbrio (50/50), 1 quando a série
  // é totalmente consistente em um lado. O termo de incerteza abaixo
  // impede que amostras pequenas sejam tratadas como certeza absoluta.
  const consistency = clamp(1 - 4 * empirical * (1 - empirical), 0, 1);

  // Concordância direta entre modelo e histórico.
  const agreement = clamp(1 - Math.abs(model - empirical), 0, 1);

  // Estabilidade: refazemos a frequência retirando uma observação por vez.
  // Menor dispersão entre essas estimativas = maior estabilidade.
  const stability = leaveOneOutStability(observationsSafe, empirical);

  // Erro padrão de uma proporção binomial. É convertido em um fator
  // de confiança conservador, sem apresentar a probabilidade como certeza.
  const standardError = n > 0
    ? Math.sqrt(Math.max(empirical * (1 - empirical), 0) / n)
    : 0.5;
  const uncertainty = clamp(1 - 2 * standardError, 0, 1);

  // Pesos fixos e explícitos. A soma é 1.
  const weighted =
    0.20 * sampleFactor +
    0.20 * consistency +
    0.25 * agreement +
    0.20 * stability +
    0.15 * uncertainty;

  const probability = round(
    clamp(
      0.60 * model +
      0.40 * empirical,
      0.01, 0.99
    ),
    4
  );

  // Confidence Score mede a força do mercado, não apenas a confiança
  // na estimativa. Uma probabilidade de 1% não pode superar um mercado
  // com 90%+ só porque sua série histórica é consistente.
  const reliability = clamp(weighted, 0, 1);
  const score = Math.round(clamp(probability * reliability, 0, 1) * 100);

  return {
    market: name,
    probability,
    score,
    confidenceScore: score,
    confidence: confidenceLabel(score),
    components: {
      sampleSize: n,
      sampleFactor: round(sampleFactor, 4),
      consistency: round(consistency, 4),
      agreement: round(agreement, 4),
      stability: round(stability, 4),
      uncertainty: round(uncertainty, 4),
      reliability: round(reliability, 4)
    },
    reason:
      `Probabilidade ${(probability * 100).toFixed(1)}%; ` +
      `Confidence Score ${score}/100. ` +
      `Amostra ${n}; concordância ${(agreement * 100).toFixed(1)}%; ` +
      `estabilidade ${(stability * 100).toFixed(1)}%.`
  };
}

function leaveOneOutStability(values, fullProbability) {
  if (values.length <= 1) return 0.5;

  const estimates = [];
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) {
      if (i !== j) sum += values[j];
    }
    estimates.push(sum / (values.length - 1));
  }

  const mean = estimates.reduce((s, x) => s + x, 0) / estimates.length;
  const variance = estimates.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / estimates.length;
  const standardDeviation = Math.sqrt(variance);

  // SD=0 => máxima estabilidade; SD>=0.25 => estabilidade mínima.
  return clamp(1 - (standardDeviation / 0.25), 0, 1);
}

function confidenceLabel(score) {
  if (score >= 90) return "very-high";
  if (score >= 80) return "high";
  if (score >= 70) return "moderate";
  if (score >= 60) return "low";
  return "very-low";
}

function expectedGoals(attack, defense, ownTotal, opponentTotal) {
  // Combinação simples e estável para amostras pequenas.
  // A média da própria produção e da vulnerabilidade adversária recebe maior peso.
  const primary = (Number(attack) + Number(defense)) / 2;
  const context = (Number(ownTotal) + Number(opponentTotal)) / 4;
  return clamp(0.65 * primary + 0.35 * context, 0.15, 4.5);
}

function empiricalMarketProbabilities(home, away) {
  const all = [...home.matches, ...away.matches];
  const n = all.length || 1;

  // Cada partida da amostra conta uma vez para os mercados de gols/BTTS.
  const total = all.map(m => Number(m.goalsFor) + Number(m.goalsAgainst));
  const btts = all.map(m => Number(m.goalsFor) > 0 && Number(m.goalsAgainst) > 0);

  // Para handicap +0.5, usamos somente as partidas em que a equipe atuou
  // no respectivo papel. Isso evita misturar o resultado do adversário.
  // Para handicap +0.5, usamos somente partidas em que cada equipe
  // atuou no mesmo papel do mercado.
  //
  // Casa +0.5 = somente jogos em que a equipe mandante atuou em casa.
  // Fora +0.5 = somente jogos em que a equipe visitante atuou fora.
  //
  // Isso evita misturar jogos em casa e fora na frequência empírica.
  const homeMatches = (home.matches || []).filter(m => m.venue === "home");
  const awayMatches = (away.matches || []).filter(m => m.venue === "away");

  const homeNotLose = ratio(homeMatches, m => m.result === "W" || m.result === "D");
  const awayNotLose = ratio(awayMatches, m => m.result === "W" || m.result === "D");

  const over15 = total.map(x => x >= 2 ? 1 : 0);
  const over25 = total.map(x => x >= 3 ? 1 : 0);
  const under25 = total.map(x => x <= 2 ? 1 : 0);
  const under35 = total.map(x => x <= 3 ? 1 : 0);
  const bttsYes = btts.map(x => x ? 1 : 0);
  const bttsNo = btts.map(x => x ? 0 : 1);
  const homePlus05Obs = homeMatches.map(m => m.result === "W" || m.result === "D" ? 1 : 0);
  const awayPlus05Obs = awayMatches.map(m => m.result === "W" || m.result === "D" ? 1 : 0);

  return {
    over15: ratio(over15, Boolean),
    over25: ratio(over25, Boolean),
    under25: ratio(under25, Boolean),
    under35: ratio(under35, Boolean),
    bttsYes: ratio(bttsYes, Boolean),
    bttsNo: ratio(bttsNo, Boolean),
    homePlus05: ratio(homePlus05Obs, Boolean),
    awayPlus05: ratio(awayPlus05Obs, Boolean),
    observations: {
      over15,
      over25,
      under25,
      under35,
      bttsYes,
      bttsNo,
      homePlus05: homePlus05Obs,
      awayPlus05: awayPlus05Obs
    }
  };
}

function blendMarket(name, modelProbability, empiricalProbability) {
  const p = clamp(
    0.60 * clamp(modelProbability, 0, 1) +
    0.40 * clamp(empiricalProbability, 0, 1),
    0.01, 0.99
  );

  return {
    market: name,
    probability: round(p, 4),
    score: Math.round(p * 100),
    reason:
      `Probabilidade estimada ${(p * 100).toFixed(1)}%; ` +
      `modelo ${(modelProbability * 100).toFixed(1)}%, ` +
      `frequência histórica ${(empiricalProbability * 100).toFixed(1)}%.`
  };
}

function ratio(values, predicate) {
  if (!values.length) return 0.5;
  return values.filter(predicate).length / values.length;
}

function poissonMatrix(lambdaHome, lambdaAway, maxGoals) {
  const matrix = [];
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      matrix.push({
        home: h,
        away: a,
        p: poisson(h, lambdaHome) * poisson(a, lambdaAway)
      });
    }
  }
  return matrix;
}

function poisson(k, lambda) {
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial;
}

function poissonProbability(matrix, predicate) {
  const selected = matrix.reduce((sum, x) => sum + (predicate(x.home, x.away) ? x.p : 0), 0);
  const total = matrix.reduce((sum, x) => sum + x.p, 0);
  return total ? selected / total : 0;
}

function totalGoalsAtLeast(n) {
  return (h, a) => h + a >= n;
}

function totalGoalsAtMost(n) {
  return (h, a) => h + a <= n;
}

function bothTeamsScore(h, a) { return h > 0 && a > 0; }
function bothTeamsDontScore(h, a) { return h === 0 || a === 0; }
function homeNotLose(h, a) { return h >= a; }
function awayNotLose(h, a) { return a >= h; }

function deriveResult(isHome, homeGoals, awayGoals) {
  if (homeGoals === awayGoals) return "D";
  const homeWon = homeGoals > awayGoals;
  return (isHome ? homeWon : !homeWon) ? "W" : "L";
}

function isBeforeFixture(matchDate, fixtureDate, fixtureId, matchId) {
  if (Number(matchId) === Number(fixtureId)) return false;

  // Se o fixture analisado tem data, um histórico sem data não pode ser
  // considerado automaticamente anterior: isso poderia introduzir partidas
  // futuras ou dados fora de ordem.
  if (!fixtureDate) return Boolean(matchDate);

  if (!matchDate) return false;

  const matchTs = new Date(matchDate).getTime();
  const fixtureTs = new Date(fixtureDate).getTime();

  if (!Number.isFinite(matchTs) || !Number.isFinite(fixtureTs)) return false;

  return matchTs < fixtureTs;
}

function subtractDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function toGoalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function avg(a, b) { return b ? a / b : 0; }
function round(v, n) { const p = 10 ** n; return Math.round(v * p) / p; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

async function sm(path, token, timeoutMs = 10000) {
  const url = `https://api.sportmonks.com${path}${path.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return { ok: r.ok, status: r.status, data };

  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        data: { error: "Tempo limite excedido ao consultar a SportMonks." }
      };
    }

    return {
      ok: false,
      status: 502,
      data: {
        error: "Falha de rede ao consultar a SportMonks.",
        details: error?.message || String(error)
      }
    };

  } finally {
    clearTimeout(timeoutId);
  }
}

function safeDetails(d) {
  return d ? { message: d.message, errors: d.errors, raw: d.raw } : null;
}




