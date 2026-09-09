(function () {
  "use strict";

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
        if (typeof input === "string") return originalFetch(targetUrl, init);
        return originalFetch(new Request(targetUrl, input), init);
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

  if (!dateInput || !searchButton || !statusElement || !gamesList) return;

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

  const filterWrap = document.createElement("div");
  filterWrap.className = "green-engine-league-filters";
  filterWrap.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0 12px;";

  const genderSelect = document.createElement("select");
  genderSelect.id = "gameGenderFilter";
  genderSelect.setAttribute("aria-label", "Filtrar por gênero");
  genderSelect.innerHTML = `
    <option value="all">Todos os gêneros</option>
    <option value="male">Masculino</option>
    <option value="female">Feminino</option>
  `;

  const leagueSelect = document.createElement("select");
  leagueSelect.id = "gameLeagueFilter";
  leagueSelect.setAttribute("aria-label", "Filtrar por liga");
  leagueSelect.innerHTML = `<option value="all">Todas as ligas úteis</option>`;

  [genderSelect, leagueSelect].forEach(select => {
    select.style.cssText = "width:100%;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.15);";
  });
  filterWrap.append(genderSelect, leagueSelect);
  searchButton.parentNode?.insertBefore(filterWrap, searchButton);

  let availableLeagues = [];
  let lastGames = [];

  function leagueKey(game) {
    const league = game?.league || {};
    return `${String(league.id ?? "")}::${String(league.name ?? "")}`;
  }

  function renderLeagueOptions(games) {
    const byKey = new Map();
    games.forEach(game => {
      const league = game?.league;
      if (!league?.name) return;
      const key = leagueKey(game);
      if (!byKey.has(key)) byKey.set(key, league);
    });

    const current = leagueSelect.value;
    leagueSelect.innerHTML = `<option value="all">Todas as ligas úteis</option>`;
    Array.from(byKey.values())
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"))
      .forEach(league => {
        const option = document.createElement("option");
        option.value = `${league.id ?? ""}::${league.name}`;
        option.textContent = `${league.country ? `${league.country} · ` : ""}${league.name}`;
        leagueSelect.appendChild(option);
      });

    if (Array.from(leagueSelect.options).some(option => option.value === current)) {
      leagueSelect.value = current;
    }
  }

  function getFilteredGames() {
    const gender = genderSelect.value;
    const league = leagueSelect.value;
    return lastGames.filter(game => {
      const gameGender = game?.league?.gender || null;
      const genderOk = gender === "all" || gameGender === gender;
      const leagueOk = league === "all" || leagueKey(game) === league;
      return genderOk && leagueOk;
    });
  }

  function renderGames(games) {
    clearGames();
    if (!games.length) {
      setStatus("Nenhum jogo corresponde aos filtros selecionados.");
      return;
    }

    setStatus(`${games.length} jogo(s) encontrado(s) nas ligas úteis.`);
    games.forEach(function (game) {
      const item = document.createElement("div");
      item.className = "game-search-item";

      const fixtureId =
        game.fixture_id ?? game.fixtureId ?? game.fixture?.id ?? game.id ?? null;
      const provider = String(game.provider || "sportmonks").toLowerCase();

      const homeName =
        game.home_team?.name ?? game.homeTeam?.name ?? game.home?.name ??
        game.home_name ?? game.participants?.[0]?.name ?? "Mandante";
      const awayName =
        game.away_team?.name ?? game.awayTeam?.name ?? game.away?.name ??
        game.away_name ?? game.participants?.[1]?.name ?? "Visitante";

      const leagueName = game.league?.name || "Liga não informada";
      const providerLabel = provider === "api-football" ? "API-Football" : "SportMonks";
      const genderLabel = game.league?.gender === "female" ? "Feminino" : game.league?.gender === "male" ? "Masculino" : "Internacional";
      item.textContent = `${homeName} × ${awayName} · ${leagueName} · ${genderLabel} · ${providerLabel}`;

      if (fixtureId) {
        item.dataset.fixtureId = String(fixtureId);
        item.dataset.provider = provider;
        item.addEventListener("click", function () {
          document.dispatchEvent(new CustomEvent("greenEngineFixtureSelected", {
            detail: {
              id: fixtureId,
              provider,
              league: game.league || null,
              source: game
            }
          }));
        });
      }

      gamesList.appendChild(item);
    });
  }

  genderSelect.addEventListener("change", () => renderGames(getFilteredGames()));
  leagueSelect.addEventListener("change", () => renderGames(getFilteredGames()));

  async function loadLeagueCatalog() {
    try {
      const response = await fetch("/api/leagues", { method: "GET", headers: { "Accept": "application/json" } });
      if (!response.ok) return;
      const data = await response.json();
      availableLeagues = Array.isArray(data?.data) ? data.data : [];
      window.greenEngineLeagueCatalog = availableLeagues;
    } catch (error) {
      console.warn("[Green Engine] Catálogo de ligas indisponível:", error);
    }
  }

  async function loadGamesByDate() {
    const selectedDate = dateInput.value;
    if (!selectedDate) {
      setStatus("Selecione uma data para pesquisar os jogos.");
      clearGames();
      return;
    }

    setStatus("Pesquisando jogos nas ligas úteis...");
    clearGames();

    try {
      const response = await fetch(
        `/api/sports?date=${encodeURIComponent(selectedDate)}`,
        { method: "GET", headers: { "Accept": "application/json" } }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      window.greenEngineGamesSearch = { date: selectedDate, response: data };

      let games = [];
      if (Array.isArray(data)) games = data;
      else if (Array.isArray(data.data)) games = data.data;
      else if (Array.isArray(data.fixtures)) games = data.fixtures;
      else if (Array.isArray(data.results)) games = data.results;

      lastGames = games.filter(game => game?.league?.enabled !== false);
      renderLeagueOptions(lastGames);
      renderGames(getFilteredGames());
    } catch (error) {
      console.error("[Green Engine] Erro na pesquisa:", error);
      setStatus("Não foi possível carregar os jogos.");
      clearGames();
    }
  }

  dateInput.value = getTodayLocal();
  searchButton.addEventListener("click", loadGamesByDate);
  window.greenEngineSearchGames = loadGamesByDate;
  loadLeagueCatalog();
})();

(function installDashboardMarketPolish() {
  const style = document.createElement("style");
  style.textContent = `
    .markets-table th { color:#ffffff !important; font-weight:800 !important; text-shadow:none !important; opacity:1 !important; }
    .markets-table tbody td { color:#f1f5f9 !important; font-weight:650 !important; text-shadow:none !important; opacity:1 !important; }
    .markets-table tbody tr:nth-child(even) td { background:rgba(255,255,255,.018); }
    .markets-table tbody tr:hover td { background:rgba(255,255,255,.045); }
    .markets-table td.market-name { color:#ffffff !important; font-weight:800 !important; text-shadow:none !important; }
    .markets-table td.muted { color:#dbe4ee !important; opacity:1 !important; text-shadow:none !important; }
    .markets-table .badge-pill { font-weight:800 !important; letter-spacing:.02em; text-shadow:none !important; }
    .green-engine-league-filters select { color-scheme:dark; }
  `;
  document.head.appendChild(style);

  const originalRenderMarketsTable = window.renderMarketsTable;
  if (typeof originalRenderMarketsTable === "function") {
    window.renderMarketsTable = function (greenScore) {
      originalRenderMarketsTable(greenScore);
      const markets = Array.isArray(greenScore?.markets) ? greenScore.markets : [];
      const summary = document.getElementById("summaryMarketsCount");
      if (summary) summary.textContent = markets.length ? String(markets.length) : "—";

      const recommended = greenScore?.recommendedMarket;
      if (!recommended) return;
      const market = markets.find(entry => entry?.market === recommended);
      const row = Array.from(document.querySelectorAll("#marketsTableBody tr"))
        .find(tr => tr.querySelector(".market-name")?.textContent?.trim() === recommended);
      if (!row || !market) return;

      const currentOdd = Number(market.currentOdd ?? market.odd ?? market.odds?.current);
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
