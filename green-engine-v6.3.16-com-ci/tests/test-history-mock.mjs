import assert from "node:assert/strict";
import { historyCore } from "../cloudflare/history-core.js";

const originalFetch = globalThis.fetch;

const fixtureId = 19722813;
const homeId = 180;
const awayId = 53;

function participants(home, away) {
  return [
    {
      id: home,
      name: home === homeId ? "Kilmarnock" : "Celtic",
      meta: { location: "home" }
    },
    {
      id: away,
      name: away === homeId ? "Kilmarnock" : "Celtic",
      meta: { location: "away" }
    }
  ];
}

function historyFixture(id, home, away, date, hg, ag) {
  return {
    id,
    starting_at: date,
    participants: participants(home, away),
    scores: [
      {
        description: "CURRENT",
        score: {
          goals: hg,
          participant: "home"
        }
      },
      {
        description: "CURRENT",
        score: {
          goals: ag,
          participant: "away"
        }
      }
    ],
    statistics: [
      {
        type_id: 34,
        participant_id: home,
        location: "home",
        data: { value: 4 }
      },
      {
        type_id: 34,
        participant_id: away,
        location: "away",
        data: { value: 6 }
      },
      {
        type_id: 84,
        participant_id: home,
        location: "home",
        data: { value: 2 }
      },
      {
        type_id: 84,
        participant_id: away,
        location: "away",
        data: { value: 3 }
      }
    ],
    state: {
      name: "Full Time"
    }
  };
}

const homeHistory = [
  historyFixture(100001, 180, 301, "2026-08-01 12:00:00", 2, 0),
  historyFixture(100002, 302, 180, "2026-07-25 12:00:00", 1, 1),
  historyFixture(100003, 180, 303, "2026-07-18 12:00:00", 3, 1),
  historyFixture(100004, 304, 180, "2026-07-11 12:00:00", 0, 1),
  historyFixture(100005, 180, 305, "2026-07-04 12:00:00", 2, 2)
];

const awayHistory = [
  historyFixture(100006, 401, 53, "2026-08-02 12:00:00", 0, 2),
  historyFixture(100007, 53, 402, "2026-07-26 12:00:00", 1, 1),
  historyFixture(100008, 403, 53, "2026-07-19 12:00:00", 2, 3),
  historyFixture(100009, 53, 404, "2026-07-12 12:00:00", 2, 0),
  historyFixture(100010, 405, 53, "2026-07-05 12:00:00", 1, 2)
];

function fixtureResponse() {
  return {
    data: {
      id: fixtureId,
      name: "Kilmarnock vs Celtic",
      starting_at: "2026-08-09 12:30:00",
      participants: [
        {
          id: homeId,
          name: "Kilmarnock",
          meta: { location: "home" }
        },
        {
          id: awayId,
          name: "Celtic",
          meta: { location: "away" }
        }
      ],
      league: {
        name: "Premiership"
      },
      state: {
        name: "Full Time"
      },
      scores: []
    }
  };
}

function teamResponse(teamId) {
  const latest = teamId === homeId ? homeHistory : awayHistory;

  return {
    data: {
      id: teamId,
      name: teamId === homeId ? "Kilmarnock" : "Celtic",
      latest
    }
  };
}

function historyResponse(teamId) {
  return {
    data: {
      data: teamId === homeId ? homeHistory : awayHistory
    }
  };
}

globalThis.fetch = async (url) => {
  const u = new URL(url);

  console.log("MOCK FETCH:", u.pathname + u.search);

  if (u.pathname === `/v3/football/fixtures/${fixtureId}`) {
    return new Response(
      JSON.stringify(fixtureResponse()),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const teamMatch = u.pathname.match(
    /^\/v3\/football\/teams\/(\d+)$/
  );

  if (teamMatch) {
    return new Response(
      JSON.stringify(
        teamResponse(Number(teamMatch[1]))
      ),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const historyMatch = u.pathname.match(
    /^\/v3\/football\/fixtures\/between\/([^/]+)\/([^/]+)$/
  );

  if (historyMatch) {
    /*
     * v6.3.15-CF.4 — mock compatível com fixtures/between
     *
     * O history-core NÃO envia filter=participantIds.
     * Ele recebe todos os fixtures da janela e filtra localmente
     * pelos participantes de cada equipe.
     */
    const allHistory = [
      ...homeHistory,
      ...awayHistory
    ];

    console.log("=== MOCK BETWEEN RESPONSE ===");
    console.log("TOTAL FIXTURES:", allHistory.length);

    return new Response(
      JSON.stringify({
        data: allHistory,
        pagination: {
          has_more: false,
          next_page: null
        }
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  return new Response(
    JSON.stringify({ data: { data: [] } }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
};

try {
  const result = await historyCore(
    String(fixtureId),
    "MOCK_TOKEN"
  );

  console.log("");
  console.log("=== RESULTADO ===");
  console.log(JSON.stringify(result, null, 2));

  assert.equal(result.statusCode, 200, "cenário feliz deveria retornar 200");
  assert.equal(result.body.ok, true, "body.ok deveria ser true");
  assert.equal(result.body.history.home.sampleSize, 5, "amostra casa deveria ter 5 partidas válidas");
  assert.equal(result.body.history.away.sampleSize, 5, "amostra fora deveria ter 5 partidas válidas");
  assert.ok(
    Array.isArray(result.body.greenScore?.markets) && result.body.greenScore.markets.length > 0,
    "greenScore.markets deveria ser um array não vazio"
  );

  const marketNames = result.body.greenScore.markets.map(m => m.market);

  for (const market of [
    "Escanteios Over 8.5",
    "Escanteios Over 10.5",
    "Escanteios Under 12.5",
    "Cartões amarelos Over 3.5",
    "Cartões amarelos Over 4.5",
    "Cartões amarelos Under 6.5"
  ]) {
    assert.ok(
      marketNames.includes(market),
      `mercado adicional ausente: ${market}`
    );
  }

  assert.equal(
    result.body.greenScore.markets.length,
    14,
    "o Green Score deveria conter 8 mercados existentes + 6 novos mercados estatísticos"
  );

  console.log("\n✅ test-history-mock: mercados existentes + escanteios + cartões amarelos validados.");
} catch (error) {
  console.error("");
  console.error("=== ERRO ===");
  console.error(error);
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
