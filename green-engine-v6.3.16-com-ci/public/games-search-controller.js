(function () {
  "use strict";

  const API_BASE = "https://green-engine-v6-3-16-cf.gerenteheliton.workers.dev";
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
          if (context.resolvedId) parsed.searchParams.set("fixture", context.resolvedId);
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
      console.warn("[Green Engine] Proxy de API nao aplicado:", error);
    }
    return originalFetch(input, init);
  };

  const dateInput = document.getElementById("search-date");
  const searchButton = document.getElementById("search-btn");
  const gamesList = document.getElementById("games-list");
  const statusEl = document.getElementById("search-status");

  if (!dateInput || !searchButton || !gamesList) {
    console.warn("[Green Engine] Elementos de pesquisa nao encontrados no DOM.");
    return;
  }

  function today() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message || "";
  }

  function clearGames() {
    gamesList.innerHTML = "";
  }

  function getGames(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.fixtures)) return payload.fixtures;
    if (Array.isArray(payload?.response)) return payload.response;
    return [];
  }

  function renderGames(games) {
    clearGames();
    if (!games.length) {
      setStatus("Nenhum jogo encontrado para esta data.");
      return;
    }

    setStatus(`${games.length} jogo(s) encontrado(s).`);

    games.forEach(game => {
      const fixtureId = game?.id ?? game?.fixture_id ?? game?.fixture?.id ?? null;
      const provider = String(game?.provider || "api-football").toLowerCase();
      const home = game?.home?.name ?? game?.teams?.home?.name ?? game?.home_name ?? "Casa";
      const away = game?.away?.name ?? game?.teams?.away?.name ?? game?.away_name ?? "Fora";
      const league = game?.league?.name ?? game?.league_name ?? game?.competition?.name ?? "Liga não informada";
      const date = game?.date ?? game?.starting_at ?? game?.fixture?.date ?? dateInput.value ?? today();

      const item = document.createElement("button");
      item.type = "button";
      item.className = "game-search-item";
      item.textContent = `${home} × ${away} · ${league}`;
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
            resolvedId: null
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
