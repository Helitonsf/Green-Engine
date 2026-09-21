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

  function setStatus(text) { status.textContent = text; }

  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function isFixtureFinished(game) {
    if (!game) return false;
    const status = game.status || {};
    const short = String(status.short || status.long || game.state || "").trim().toUpperCase();
    const long = String(status.long || game.state || "").trim().toUpperCase();
    const finished = new Set(["FT","AET","PEN","PST","CANC","ABD","AWD","WO","FINISHED","MATCH FINISHED","AWARDED","CANCELLED","POSTPONED"]);
    return finished.has(short) || finished.has(long);
  }

  function getGames(data) {
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.games)) return data.games;
    if (Array.isArray(data?.response)) return data.response;
    return [];
  }

  function clearGames() { gamesList.innerHTML = ""; }

  function renderGames(games) {
    gamesList.innerHTML = "";
    (games || []).forEach(game => {
      if (isFixtureFinished(game)) return;
      const fixtureId = game?.fixture_id ?? game?.fixtureId ?? game?.fixture?.id ?? game?.id;
      const provider = String(game?.provider || "auto").toLowerCase();
      const name = game.name || ((game.home?.name || "?") + " vs " + (game.away?.name || "?"));
      const league = game.league?.name || "";
      const item = document.createElement("button");
      item.type = "button";
      item.className = "game-item";
      item.textContent = league ? name + " · " + league : name;
      item.dataset.fixtureId = fixtureId != null ? String(fixtureId) : "";
      item.dataset.provider = provider;
      if (fixtureId != null) {
        const key = String(fixtureId);
        const date = String(game.starting_at || game.date || "").slice(0, 10);
        fixtureContexts[key] = {
          date,
          home: game.home?.name || "",
          away: game.away?.name || "",
          provider,
          sportsItem: game
        };
        item.addEventListener("click", () => {
          window.dispatchEvent(new CustomEvent("greenEngineFixtureSelected", {
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
      const games = getGames(data).filter(g => !isFixtureFinished(g));

      if (!response.ok) {
        const rateLimited =
          response.status === 429 ||
          af.rateLimited ||
          /limite|rate\s*limit|too many/i.test(String(data?.error || ""));
        if (rateLimited) {
          setStatus(
            fd.configured
              ? "API-Football no limite. Fallback ativo, mas sem jogos nas 12 ligas free nesta data. Tente outra data (ex.: 20/09) ou aguarde a cota."
              : "API-Football no limite de requisições. Aguarde alguns minutos."
          );
          clearGames();
          return;
        }
        throw new Error(data?.error || `HTTP ${response.status}`);
      }

      const mode = String(data?.providerMode || "");
      const viaFallback = /fallback|football-data/i.test(mode);
      const excluded = Number(data?.meta?.beforeFilter || 0) - games.length;
      if (viaFallback) {
        setStatus(games.length + " jogo(s) pendente(s)/ao vivo via fallback (football-data). Encerrados ocultos.");
      } else if (af.rateLimited && games.length) {
        setStatus(games.length + " jogo(s) (com fallback). Encerrados ocultos.");
      } else {
        setStatus(games.length + " jogo(s) pendente(s)/ao vivo" + (excluded > 0 ? " (" + excluded + " encerrado(s) oculto(s))" : "") + ".");
      }
      renderGames(games);
    } catch (error) {
      console.error("[Green Engine] Erro na pesquisa:", error);
      const msg = error?.message || "erro de conexao";
      if (/limite|rate\s*limit|too many|429/i.test(msg)) {
        setStatus("API-Football no limite — tente outra data com ligas free (BR/EU) ou aguarde a cota.");
      } else {
        setStatus("Não foi possível carregar os jogos: " + msg);
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
