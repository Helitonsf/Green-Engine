const API_BASE = "https://api.sportmonks.com";

export default async (req) => {
  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) return json({ error: "SPORTMONKS_API_TOKEN não configurado no Netlify." }, 500);

  const u = new URL(req.url);
  const fixtureId = u.searchParams.get("fixture");
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit") || 5), 3), 5);

  if (!fixtureId || !/^\d+$/.test(fixtureId)) {
    return json({ error: "Fixture inválido. Use ?fixture=ID." }, 400);
  }

  try {
    const base = await sm(`/v3/football/fixtures/${fixtureId}?include=participants;league;state;scores`, token);
    if (!base.ok || !base.data?.data) {
      return json({ error: "Não foi possível consultar o fixture.", status: base.status, details: safeDetails(base.data) }, base.status || 502);
    }

    const f = base.data.data;
    const participants = Array.isArray(f.participants) ? f.participants : [];
    const home = participants.find(p => p.meta?.location === "home");
    const away = participants.find(p => p.meta?.location === "away");
    if (!home || !away) return json({ error: "Fixture sem participantes home/away." }, 422);

    const [homeHistory, awayHistory] = await Promise.all([
      teamHistory(home.id, limit, token),
      teamHistory(away.id, limit, token)
    ]);

    const score = buildGreenScore(homeHistory, awayHistory);
    return json({
      ok: true,
      fixture: { id: f.id, name: f.name, starting_at: f.starting_at, league: f.league?.name || null },
      teams: {
        home: { id: home.id, name: home.name, history: homeHistory },
        away: { id: away.id, name: away.name, history: awayHistory }
      },
      greenEngine: score,
      diagnostic: {
        fixtureRequestOk: true,
        homeHistoryCount: homeHistory.matches.length,
        awayHistoryCount: awayHistory.matches.length
      }
    });
  } catch (e) {
    return json({ error: "Falha no backend.", details: e.message }, 502);
  }
};

async function teamHistory(teamId, limit, token) {
  const r = await sm(`/v3/football/teams/${teamId}?include=latest`, token);
  if (!r.ok || !r.data?.data) {
    return { teamId, matches: [], error: `SportMonks status ${r.status}` };
  }

  const latest = Array.isArray(r.data.data.latest) ? r.data.data.latest : [];
  const fixtures = latest.filter(x => x && x.id).slice(0, limit);
  const matches = await Promise.all(fixtures.map(x => summarizeFixture(x.id, teamId, token)));
  const valid = matches.filter(Boolean);

  const totals = valid.reduce((a, m) => {
    a.played += 1;
    a.goalsFor += m.goalsFor;
    a.goalsAgainst += m.goalsAgainst;
    a.cornersFor += m.cornersFor;
    a.cornersAgainst += m.cornersAgainst;
    a.shotsFor += m.shotsFor;
    a.shotsOnTargetFor += m.shotsOnTargetFor;
    a.yellowCards += m.yellowCards;
    if (m.result === "W") a.wins += 1;
    else if (m.result === "D") a.draws += 1;
    else if (m.result === "L") a.losses += 1;
    return a;
  }, { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, cornersFor: 0, cornersAgainst: 0, shotsFor: 0, shotsOnTargetFor: 0, yellowCards: 0 });

  const n = Math.max(1, totals.played);
  return {
    teamId,
    matches: valid,
    totals,
    averages: {
      goalsFor: round(totals.goalsFor / n),
      goalsAgainst: round(totals.goalsAgainst / n),
      cornersFor: round(totals.cornersFor / n),
      cornersAgainst: round(totals.cornersAgainst / n),
      shotsFor: round(totals.shotsFor / n),
      shotsOnTargetFor: round(totals.shotsOnTargetFor / n),
      yellowCards: round(totals.yellowCards / n)
    }
  };
}

async function summarizeFixture(id, teamId, token) {
  const r = await sm(`/v3/football/fixtures/${id}?include=participants;statistics;scores`, token);
  if (!r.ok || !r.data?.data) return null;
  const f = r.data.data;
  const p = Array.isArray(f.participants) ? f.participants : [];
  const me = p.find(x => Number(x.id) === Number(teamId));
  if (!me) return null;
  const loc = me.meta?.location;
  const opp = p.find(x => x.meta?.location && x.meta.location !== loc);
  const scores = Array.isArray(f.scores) ? f.scores : [];
  const current = scores.find(s => String(s.description || s.type?.description || "").toLowerCase().includes("current")) || scores[0];
  const homeGoals = Number(current?.score?.goals ?? current?.goals?.home ?? 0);
  const awayGoals = Number(current?.score?.goals ?? current?.goals?.away ?? 0);
  // SportMonks score objects can be participant-scoped; recover goals from participant metadata when present.
  const goalByParticipant = {};
  for (const s of scores) {
    if (s.participant_id != null && s.score?.goals != null) goalByParticipant[s.participant_id] = Number(s.score.goals);
  }
  const gf = goalByParticipant[me.id] ?? (loc === "home" ? homeGoals : awayGoals);
  const ga = opp ? (goalByParticipant[opp.id] ?? (loc === "home" ? awayGoals : homeGoals)) : 0;

  const stats = Array.isArray(f.statistics) ? f.statistics : [];
  const stat = (names, participantId = teamId) => {
    const s = stats.find(x => Number(x.participant_id) === Number(participantId) && names.includes(String(x.type?.name || "").toLowerCase()));
    const v = s?.data?.value ?? s?.data;
    return typeof v === "number" ? v : 0;
  };
  const cornersFor = stat(["corner kicks", "corners", "corner"]);
  const shotsFor = stat(["shots total", "total shots", "shots"]);
  const shotsOnTargetFor = stat(["shots on target", "on target"]);
  const yellowCards = stat(["yellow cards", "yellowcard", "yellow cards total"]);

  return {
    id: f.id,
    name: f.name,
    starting_at: f.starting_at,
    opponent: opp?.name || null,
    venue: loc,
    goalsFor: gf,
    goalsAgainst: ga,
    totalGoals: gf + ga,
    cornersFor,
    cornersAgainst: stat(["corner kicks", "corners", "corner"], opp?.id),
    shotsFor,
    shotsOnTargetFor,
    yellowCards,
    result: gf > ga ? "W" : gf === ga ? "D" : "L"
  };
}

function buildGreenScore(home, away) {
  const hg = home.averages;
  const ag = away.averages;
  const goalSignal = clamp(50 + ((hg.goalsFor + ag.goalsFor) - (hg.goalsAgainst + ag.goalsAgainst)) * 8, 20, 90);
  const cornerSignal = clamp(50 + ((hg.cornersFor + ag.cornersFor) - 10) * 5, 20, 90);
  const shotSignal = clamp(50 + ((hg.shotsOnTargetFor + ag.shotsOnTargetFor) - 5) * 6, 20, 90);
  const formSignal = clamp(50 + ((home.totals.wins / Math.max(1, home.totals.played)) + (away.totals.wins / Math.max(1, away.totals.played)) - 0.6) * 50, 20, 90);

  const markets = [
    { market: "Gols", score: Math.round(goalSignal), reason: "Produção e concessão de gols no histórico recente." },
    { market: "Escanteios", score: Math.round(cornerSignal), reason: "Média recente de escanteios das duas equipes." },
    { market: "Finalizações no alvo", score: Math.round(shotSignal), reason: "Volume recente de finalizações no alvo." },
    { market: "Forma", score: Math.round(formSignal), reason: "Percentual de vitórias no histórico consultado." }
  ].sort((a, b) => b.score - a.score);

  return {
    version: "6.3",
    score: Math.round(markets.reduce((s, m) => s + m.score, 0) / markets.length),
    confidence: markets[0]?.score || null,
    recommendedMarket: markets[0]?.market || null,
    markets
  };
}

async function sm(path, token) {
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

function safeDetails(d) { return d ? { message: d.message, errors: d.errors, raw: d.raw } : null; }
function round(v) { return Math.round(v * 100) / 100; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }
