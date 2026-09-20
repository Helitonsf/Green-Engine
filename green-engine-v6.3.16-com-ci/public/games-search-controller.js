(() => {
  const API_BASE = (() => {
    try {
      if (typeof window !== "undefined" && window.location && /workers\.dev$/i.test(window.location.hostname)) {
        return "";
      }
    } catch (_) {}
    return "https://green-engine-v6-3-15-cf.gerenteheliton.workers.dev";
  })();

  const originalFetch = window.fetch.bind(window);
  const fixtureContexts = {};
  window.greenEngineFixtureContexts = fixtureContexts;

  function today() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function getGames(data) {
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.games)) return data.games;
    if (Array.isArray(data?.response)) return data.response;
    return [];
  }

  function clearGames() {
    const gamesList = document.getElementById("gamesList");
    if (gamesList) gamesList.innerHTML = "";
  }

  function renderGames(games) {
    const gamesList = document.getElementById("gamesList");
    if (!gamesList) return;
    gamesList.innerHTML = "";
    for (const game of games) {
      const id = game.id || game.fixture_id;
      if (!id) continue;
      const name = game.name || `${game.home?.name || "?"} vs ${game.away?.name || "?"}`;
      const league = game.league?.name || "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "game-item";
      btn.textContent = league ? `${name} · ${league}` : name;
      const date = String(game.starting_at || game.date || "").slice(0, 10);
      const home = game.home?.name || "";
      const away = game.away?.name || "";
      const key = String(id);
      fixtureContexts[key] = { date, home, away, sportsItem: game };
      btn.addEventListener("click", () => {
        window.dispatchEvent(
          new CustomEvent("greenEngineFixtureSelected", {
            detail: {
              id: key,
              provider: game.provider || "auto",
              context: fixtureContexts[key]
            }
          })
        );
      });
      gamesList.appendChild(btn);
    }
  }

  const dateInput = document.getElementById("gameDate");
  const searchButton = document.getElementById("searchGamesBtn");
  const status = document.getElementById("gamesSearchStatus");
  const gamesList = document.getElementById("gamesList");
  if (!dateInput || !searchButton || !status || !gamesList) return;

  function setStatus(text) {
    status.textContent = text;
  }

  // Redirect absolute API calls to same-origin when on workers.dev; inject context into fixture/history
  window.fetch = function (input, init) {
    try {
      let url = typeof input === "string" ? input : input?.url;
      if (typeof url === "string" && url.startsWith("/api/")) {
        // keep relative
      } else if (typeof url === "string" && /green-engine-v6-3-1[56]-cf\.gerenteheliton\.workers\.dev/i.test(url)) {
        const u = new URL(url);
        url = u.pathname + u.search;
        input = url;
      }
    } catch (error) {
      console.warn("[Green Engine] Redirecionamento da API falhou:", error);
    }
    return originalFetch(input, init);
  };

  async function loadGamesByDate() {
    const selectedDate = dateInput.value || today();
    dateInput.value = selectedDate;
    setStatus("Pesquisando jogos (API-Football → fallback se necessário)…");
    clearGames();

    try {
      const response = await originalFetch(`${API_BASE}/api/sports?date=${encodeURIComponent(selectedDate)}`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));
      window.greenEngineGamesSearch = { date: selectedDate, response: data };
      const sources = data?.sources || {};
      const af = sources.apiFootball || {};
      const fd = sources.footballData || {};
      const games = getGames(data);

      if (!response.ok) {
        const rateLimited =
          response.status === 429 ||
          af.rateLimited ||
          /limite|rate\s*limit|too many/i.test(String(data?.error || ""));
        if (rateLimited) {
          setStatus(
            fd.configured
              ? "API-Football no limite. Fallback football-data ativo, mas sem jogos nas 12 ligas free nesta data. Tente outra data (ex.: 20/09) ou aguarde a cota."
              : "API-Football no limite de requisições. Aguarde alguns minutos ou configure FOOTBALL_DATA_API_KEY para fallback."
          );
          clearGames();
          return;
        }
        throw new Error(data?.error || `HTTP ${response.status}`);
      }

      const mode = String(data?.providerMode || "");
      const viaFallback = /fallback|football-data/i.test(mode);
      if (viaFallback) {
        setStatus(`${games.length} jogo(s) via fallback (football-data) — API-Football no limite.`);
      } else if (af.rateLimited && games.length) {
        setStatus(`${games.length} jogo(s) (parcial/fallback). API-Football reportou limite.`);
      } else {
        setStatus(`${games.length} jogo(s) encontrado(s).`);
      }
      renderGames(games);
    } catch (error) {
      console.error("[Green Engine] Erro na pesquisa:", error);
      const msg = error?.message || "erro de conexao";
      if (/limite|rate\s*limit|too many|429/i.test(msg)) {
        setStatus("API-Football no limite — tente de novo em instantes ou outra data com ligas free (BR/EU).");
      } else {
        setStatus(`Não foi possível carregar os jogos: ${msg}`);
      }
      clearGames();
    }
  }

  dateInput.value = dateInput.value || today();
  searchButton.addEventListener("click", loadGamesByDate);
  dateInput.addEventListener("change", loadGamesByDate);
  window.greenEngineSearchGames = loadGamesByDate;
  window.addEventListener("load", () => loadGamesByDate(), { once: true });
})();
