import assert from "node:assert/strict";
import { historyCore } from "../cloudflare/history-core.js";

const originalFetch = globalThis.fetch;

const fixtureId = 19722813;
const homeId = 180;
const awayId = 53;
let betweenCalls = 0;

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
    const page = Number(u.searchParams.get("page") || "1");
    betweenCalls++;

    console.log("=== BETWEEN CALL ===");
    console.log("BETWEEN CALL:", betweenCalls);
    console.log("PAGE:", page);

    const page1 = [
      ...homeHistory.slice(0, 4),
      ...awayHistory.slice(0, 4)
    ];

    const page2 = [];

    const fallbackWindowStart = "2026-01-22";
    const fallbackWindowEnd = "2026-05-01";

    const fallbackFixtureHome = historyFixture(
      200013,
      999,
      308,
      "2026-04-20 12:00:00",
      2,
      1
    );

    const fallbackFixtureAway = historyFixture(
      200014,
      409,
      998,
      "2026-04-19 12:00:00",
      1,
      2
    );

    const isFallbackWindow =
      u.pathname.includes(
        "/v3/football/fixtures/between/" +
        fallbackWindowStart +
        "/" +
        fallbackWindowEnd
      );

    const data = isFallbackWindow
      ? [fallbackFixtureHome, fallbackFixtureAway]
      : page === 1
        ? page1
        : page2;

    console.log("PAGE FIXTURES:", data.map(f => f.id));

    return new Response(
      JSON.stringify({
        data,
        pagination: {
          has_more: page === 1,
          next_page: page === 1 ? 2 : null
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
  console.log("TOTAL BETWEEN CALLS:", betweenCalls);

  assert.equal(result.statusCode, 422, "histórico insuficiente deveria retornar 422");
  assert.equal(result.body.ok, false, "body.ok deveria ser false");
  assert.match(
    result.body.error,
    /insuficiente/i,
    "mensagem de erro deveria indicar histórico insuficiente"
  );

  console.log("\n✅ test-history-insufficient-history: todos os asserts passaram.");
} catch (error) {
  console.error("");
  console.error("=== ERRO ===");
  console.error(error);
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
