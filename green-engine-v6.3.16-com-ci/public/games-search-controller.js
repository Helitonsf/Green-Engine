(function () {
  "use strict";

  // Same-origin no Worker e em localhost; Pages usa o Worker v6-3-15 (com API_FOOTBALL_KEY).
  const API_BASE = (typeof location !== "undefined" && (
    /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ||
    /\.workers\.dev$/.test(location.hostname)
  ))
    ? ""
    : "https://green-engine-v6-3-15-cf.gerenteheliton.workers.dev";
  const originalFetch = window.fetch.bind(window);
  const fixtureContexts = window.greenEngineFixtureContexts = window.greenEngineFixtureContexts || {};

  function getContextForId(id) {
    return fixtureContexts[String(id)] || null;
  }

  function withFixtureContext(url) {
    try {
      const parsed = new URL(url, window.location.href);
      if (!parsed.pathname.startsWith("/api/")) return url;

      if (parsed.pathname === "/api/fixture") {
        const id = parsed.searchParams.get("id");
        const context = getContextForId(id);
        if (context) {
          if (context.date) parsed.searchParams.set("date", context.date);
          if (context.home) parsed.searchParams.set("home", context.home);
          if (context.away) parsed.searchParams.set("away", context.away);
        }
      }

      if (parsed.pathname === "/api/history") {
        const requestedId = parsed.searchParams.get("fixture");
        const context = getContextForId(requestedId);
        if (context) {
          if (context.resolvedId) {
            parsed.searchParams.set("fixture", context.resolvedId);
          }
          if (context.date) parsed.searchParams.set("date", context.date);
          if (context.home) parsed.searchParams.set("home", context.home);
          if (context.away) parsed.searchParams.set("away", context.away);
        }
      }

      return parsed.toString();
    } catch (error) {
      console.warn("[Green Engine] Contexto de fixture nao aplicado:", error);
      return url;
    }
  }

  window.fetch = function (input, init) {
    try {
      const rawUrl = typeof input === "string" ? input : input?.url || "";
      if (rawUrl.startsWith("/api/")) {
        const target = withFixtureContext(API_BASE + rawUrl);
        const parsedTarget = new URL(target);

        return originalFetch(target, init).then(response => {
          if (parsedTarget.pathname === "/api/fixture" && response.ok) {
            response.clone().json().then(payload => {
              const requestedId = parsedTarget.searchParams.get("id");
              const resolvedId = payload?.data?.id ?? payload?.data?.fixture_id ?? null;
              if (requestedId && resolvedId != null) {
                const context = getContextForId(requestedId);
                if (context) context.resolvedId = String(resolvedId);
              }
            }).catch(() => {});
          }
          return response;
        });
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
      const provider = String(game?.provider || "api-football").toLowerCase();
      const homeParticipant = getParticipantByLocation(game, "home");
      const awayParticipant = getParticipantByLocation(game, "away");
      const home = game?.home_team?.name ?? game?.homeTeam?.name ?? game?.home?.name ?? game?.home_name ?? homeParticipant?.name ?? game?.participants?.[0]?.name ?? "Mandante";
      const away = game?.away_team?.name ?? game?.awayTeam?.name ?? game?.away_name ?? game?.away?.name ?? awayParticipant?.name ?? game?.participants?.[1]?.name ?? "Visitante";
      const league = game?.league?.name ?? game?.league_name ?? game?.competition?.name ?? "Liga nao informada";
      const date = game?.date ?? game?.starting_at ?? game?.fixture?.date ?? dateInput.value ?? today();

      const item = document.createElement("button");
      item.type = "button";
      item.className = "game-search-item";
      item.textContent = `${home} \u00d7 ${away} \u00b7 ${league}`;
      item.dataset.fixtureId = fixtureId != null ? String(fixtureId) : "";
      item.dataset.provider = provider;
      item.style.color = "var(--text)";

      if (fixtureId != null) {
        item.addEventListener("click", () => {
          const key = String(fixtureId);
          fixtureContexts[key] = {
            referenceId: key,
            provider,
            date: String(date).slice(0, 10),
            home,
            away,
            resolvedId: null,
            sportsItem: game
          };

          document.dispatchEvent(new CustomEvent("greenEngineFixtureSelected", {
            detail: {
              id: fixtureId,
              provider,
              league: game?.league || null,
              source: game,
              context: fixtureContexts[key]
            }
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
      setStatus(`Nao foi possivel carregar os jogos: ${error?.message || "erro de conexao"}`);
      clearGames();
    }
  }

  dateInput.value = dateInput.value || today();
  searchButton.addEventListener("click", loadGamesByDate);
  dateInput.addEventListener("change", loadGamesByDate);
  window.greenEngineSearchGames = loadGamesByDate;
  window.addEventListener("load", () => loadGamesByDate(), { once: true });
})();
