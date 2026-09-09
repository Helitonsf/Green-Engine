(function () {
  "use strict";

  /*
   * O dashboard pode ser publicado no GitHub Pages, enquanto a API continua
   * no Cloudflare Worker. Mantemos os fetches existentes com /api/* e apenas
   * redirecionamos esses caminhos para o Worker quando a interface estiver
   * fora da origem do Worker.
   */
  const GREEN_ENGINE_API_BASE =
    "https://green-engine-v6-3-15-cf.gerenteheliton.workers.dev";

  const originalFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    try {
      const requestUrl =
        typeof input === "string"
          ? input
          : input && typeof input.url === "string"
            ? input.url
            : "";

      if (requestUrl.startsWith("/api/")) {
        const targetUrl = GREEN_ENGINE_API_BASE + requestUrl;

        if (typeof input === "string") {
          return originalFetch(targetUrl, init);
        }

        return originalFetch(
          new Request(targetUrl, input),
          init
        );
      }
    } catch (error) {
      console.warn("[Green Engine] Falha ao redirecionar API:", error);
    }

    return originalFetch(input, init);
  };

  const dateInput = document.getElementById("gameDate");
  const searchButton = document.getElementById("searchGamesBtn");
  const statusElement = document.getElementById("gamesSearchStatus");
  const gamesList = document.getElementById("gamesList");

  if (!dateInput || !searchButton || !statusElement || !gamesList) {
    console.warn(
      "[Green Engine] Elementos da pesquisa de jogos não encontrados."
    );
    return;
  }

  function getTodayLocal() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function setStatus(message) {
    statusElement.textContent = message;
  }

  function clearGames() {
    gamesList.innerHTML = "";
  }

  async function loadGamesByDate() {
    const selectedDate = dateInput.value;

    if (!selectedDate) {
      setStatus("Selecione uma data para pesquisar os jogos.");
      clearGames();
      return;
    }

    setStatus("Pesquisando jogos...");
    clearGames();

    try {
      const response = await fetch(
        `/api/sports?date=${encodeURIComponent(selectedDate)}`,
        {
          method: "GET",
          headers: {
            "Accept": "application/json"
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      window.greenEngineGamesSearch = {
        date: selectedDate,
        response: data
      };

      let games = [];

      if (Array.isArray(data)) {
        games = data;
      } else if (Array.isArray(data.data)) {
        games = data.data;
      } else if (Array.isArray(data.fixtures)) {
        games = data.fixtures;
      } else if (Array.isArray(data.results)) {
        games = data.results;
      }

      if (!games.length) {
        setStatus("Nenhum jogo encontrado para esta data.");
        return;
      }

      setStatus(`${games.length} jogo(s) encontrado(s).`);

      games.forEach(function (game) {
        const item = document.createElement("div");

        item.className = "game-search-item";

        const fixtureId =
          game.fixture_id ??
          game.fixtureId ??
          game.fixture?.id ??
          game.id ??
          null;

        const homeName =
          game.home_team?.name ??
          game.homeTeam?.name ??
          game.home?.name ??
          game.home_name ??
          game.participants?.[0]?.name ??
          "Mandante";

        const awayName =
          game.away_team?.name ??
          game.awayTeam?.name ??
          game.away?.name ??
          game.away_name ??
          game.participants?.[1]?.name ??
          "Visitante";

        item.textContent = `${homeName} × ${awayName}`;

        if (fixtureId) {
          item.dataset.fixtureId = String(fixtureId);

          item.addEventListener("click", function () {
            document.dispatchEvent(
              new CustomEvent("greenEngineFixtureSelected", {
                detail: {
                  id: fixtureId
                }
              })
            );
          });
        }

        gamesList.appendChild(item);
      });

    } catch (error) {
      console.error("[Green Engine] Erro na pesquisa:", error);

      setStatus("Não foi possível carregar os jogos.");
      clearGames();
    }
  }

  dateInput.value = getTodayLocal();

  searchButton.addEventListener(
    "click",
    loadGamesByDate
  );

  window.greenEngineSearchGames = loadGamesByDate;
})();

/*
 * J.2.10-UI: acabamento visual e proteção da decisão operacional.
 * A seleção do melhor mercado continua sendo feita pelo motor; esta camada
 * apenas melhora a leitura e impede que "APOSTAR" apareça sem odd real.
 */
(function installDashboardMarketPolish() {
  const style = document.createElement("style");
  style.textContent = `
    /* Contraste nítido: sem sombra em texto branco, que estava criando
       aparência borrada em alguns monitores/navegadores. */
    .markets-table th {
      color: #ffffff !important;
      font-weight: 800 !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    .markets-table tbody td {
      color: #f1f5f9 !important;
      font-weight: 650 !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    .markets-table tbody tr:nth-child(even) td {
      background: rgba(255,255,255,.018);
    }
    .markets-table tbody tr:hover td {
      background: rgba(255,255,255,.045);
    }
    .markets-table td.market-name {
      color: #ffffff !important;
      font-weight: 800 !important;
      text-shadow: none !important;
    }
    .markets-table td.muted {
      color: #dbe4ee !important;
      opacity: 1 !important;
      text-shadow: none !important;
    }
    .markets-table .badge-pill {
      font-weight: 800 !important;
      letter-spacing: .02em;
      text-shadow: none !important;
    }
  `;
  document.head.appendChild(style);

  const originalRenderMarketsTable = window.renderMarketsTable;

  if (typeof originalRenderMarketsTable === "function") {
    window.renderMarketsTable = function (greenScore) {
      originalRenderMarketsTable(greenScore);

      const markets = Array.isArray(greenScore?.markets)
        ? greenScore.markets
        : [];

      const summary = document.getElementById("summaryMarketsCount");
      if (summary) {
        summary.textContent = markets.length ? String(markets.length) : "—";
      }

      const recommended = greenScore?.recommendedMarket;
      if (!recommended) return;

      const market = markets.find(function (entry) {
        return entry?.market === recommended;
      });

      const row = Array.from(
        document.querySelectorAll("#marketsTableBody tr")
      ).find(function (tr) {
        return tr.querySelector(".market-name")?.textContent?.trim() === recommended;
      });

      if (!row || !market) return;

      const currentOdd = Number(
        market.currentOdd ??
        market.odd ??
        market.odds?.current
      );

      const badgeCell = row.lastElementChild;
      if (!badgeCell) return;

      let label = "SEM ODDS";
      let cls = "badge-neutro";

      if (Number.isFinite(currentOdd)) {
        if (currentOdd >= 1.40 && currentOdd <= 1.60) {
          label = "APOSTAR";
          cls = "badge-apostar";
        } else {
          label = "FORA DA FAIXA";
        }
      }

      badgeCell.innerHTML = `<span class="badge-pill ${cls}">${label}</span>`;
    };
  }
})();
