(function () {
  "use strict";

  const API_BASE = "https://green-engine-v6-3-15-cf.gerenteheliton.workers.dev";
  const originalFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (url.startsWith("/api/")) {
        const target = API_BASE + url;
        return typeof input === "string"
          ? originalFetch(target, init)
          : originalFetch(new Request(target, input), init);
      }
    } catch (error) {
      console.warn("[Green Engine] Redirecionamento da API falhou:", error);
    }
    return originalFetch(input, init);
  };

  const dateInput = document.getElementById("gameDate");
  const searchButton = document.getElementById("searchGamesBtn");
  const status = document.getElementById("gamesSearchStatus");
  const gamesList = document.getElementById("gamesList");
  if (!dateInput || !searchButton || !status || !gamesList) return;

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  function setStatus(text) { status.textContent = text; }
  function clearGames() { gamesList.innerHTML = ""; }

  function getGames(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.fixtures)) return data.fixtures;
    if (Array.isArray(data?.results)) return data.results;
    return [];
  }

  function getParticipantByLocation(game, location) {
    const participants = Array.isArray(game?.participants) ? game.participants : [];
    return participants.find(p => String(p?.meta?.location || "").toLowerCase() === location) || null;
  }

  function renderGames(games) {
    clearGames();
    if (!games.length) {
      setStatus("Nenhum jogo encontrado para esta data.");
      return;
    }

    setStatus(`${games.length} jogo(s) encontrado(s).`);
    games.forEach(game => {
      const fixtureId = game?.fixture_id ?? game?.fixtureId ?? game?.fixture?.id ?? game?.id;
      const provider = String(game?.provider || "sportmonks").toLowerCase();
      const homeParticipant = getParticipantByLocation(game, "home");
      const awayParticipant = getParticipantByLocation(game, "away");
      const home = game?.home_team?.name ?? game?.homeTeam?.name ?? game?.home?.name ?? game?.home_name ?? homeParticipant?.name ?? game?.participants?.[0]?.name ?? "Mandante";
      const away = game?.away_team?.name ?? game?.awayTeam?.name ?? game?.away?.name ?? game?.away_name ?? awayParticipant?.name ?? game?.participants?.[1]?.name ?? "Visitante";
      const league = game?.league?.name ?? game?.league_name ?? game?.competition?.name ?? "Liga não informada";

      const item = document.createElement("button");
      item.type = "button";
      item.className = "game-search-item";
      item.textContent = `${home} × ${away} · ${league}`;
      item.dataset.fixtureId = fixtureId != null ? String(fixtureId) : "";
      item.dataset.provider = provider;
      item.style.color = "var(--text)";

      if (fixtureId != null) {
        item.addEventListener("click", () => {
          document.dispatchEvent(new CustomEvent("greenEngineFixtureSelected", {
            detail: { id: fixtureId, provider, league: game?.league || null, source: game }
          }));
        });
      } else {
        item.disabled = true;
      }
      gamesList.appendChild(item);
    });
  }

  async function loadGamesByDate() {
    const selectedDate = dateInput.value || today();
    dateInput.value = selectedDate;
    setStatus("Pesquisando jogos...");
    clearGames();

    try {
      const response = await originalFetch(`${API_BASE}/api/sports?date=${encodeURIComponent(selectedDate)}`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));
      window.greenEngineGamesSearch = { date: selectedDate, response: data };
      if (!response.ok) {
        const message = data?.error || `HTTP ${response.status}`;
        throw new Error(message);
      }
      renderGames(getGames(data));
    } catch (error) {
      console.error("[Green Engine] Erro na pesquisa:", error);
      setStatus(`Não foi possível carregar os jogos: ${error?.message || "erro de conexão"}`);
      clearGames();
    }
  }

  dateInput.value = dateInput.value || today();
  searchButton.addEventListener("click", loadGamesByDate);
  dateInput.addEventListener("change", loadGamesByDate);
  window.greenEngineSearchGames = loadGamesByDate;
  window.addEventListener("load", () => loadGamesByDate(), { once: true });
})();
