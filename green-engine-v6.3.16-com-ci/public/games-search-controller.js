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
