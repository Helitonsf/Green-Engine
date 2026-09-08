(function () {
  "use strict";

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
