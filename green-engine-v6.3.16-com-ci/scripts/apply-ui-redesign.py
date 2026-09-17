#!/usr/bin/env python3
"""Apply UI redesign patches to public/index.html before Worker deploy."""
from pathlib import Path

p = Path("public/index.html")
html = p.read_text(encoding="utf-8")

if "ui-redesign.css" not in html:
    html = html.replace("</head>", '  <link rel="stylesheet" href="ui-redesign.css">\n</head>', 1)
    print("linked ui-redesign.css")

old_search = (
    '    <div class="panel">\n'
    '      <h3>Buscar jogo</h3>\n'
    '      <div class="search-row-inline">\n'
    '        <input id="quickFilterInput" type="text" placeholder="Filtrar por nome do time…" autocomplete="off">\n'
    '        <button type="button" class="icon-btn" id="quickFilterClear" title="Limpar filtro" aria-label="Limpar filtro">\n'
    '          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>\n'
    '        </button>\n'
    '      </div>\n'
    '    </div>\n'
    '\n'
    '    <div class="panel">\n'
    '      <h3>Filtros</h3>\n'
    '\n'
    '      <div class="field">\n'
    '        <label for="gameDate">Data</label>\n'
    '        <input id="gameDate" type="date">\n'
    '      </div>\n'
    '\n'
    '      <button type="button" id="searchGamesBtn" class="block">Pesquisar jogos</button>\n'
    '\n'
    '      <div id="gamesSearchStatus" class="muted small" style="margin-top:12px;" role="status" aria-live="polite">\n'
    '        Selecione uma data para pesquisar os jogos disponíveis.\n'
    '      </div>\n'
    '\n'
    '      <div id="gamesList" class="games-list"></div>\n'
    '    </div>'
)

new_search = (
    '    <div class="panel">\n'
    '      <h3>\n'
    '        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>\n'
    '        Pesquisa\n'
    '      </h3>\n'
    '\n'
    '      <div class="field">\n'
    '        <label for="gameDate">Data</label>\n'
    '        <input id="gameDate" type="date">\n'
    '      </div>\n'
    '\n'
    '      <button type="button" id="searchGamesBtn" class="block">Pesquisar jogos</button>\n'
    '\n'
    '      <div class="field" style="margin-top:14px;">\n'
    '        <label for="quickFilterInput">Filtrar por time</label>\n'
    '        <div class="search-row-inline">\n'
    '          <input id="quickFilterInput" type="text" placeholder="Ex.: Palmeiras, Flamengo…" autocomplete="off">\n'
    '          <button type="button" class="icon-btn" id="quickFilterClear" title="Limpar filtro" aria-label="Limpar filtro">\n'
    '            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>\n'
    '          </button>\n'
    '        </div>\n'
    '      </div>\n'
    '\n'
    '      <div id="gamesSearchStatus" class="muted small" style="margin-top:12px;" role="status" aria-live="polite">\n'
    '        Selecione uma data para pesquisar os jogos disponíveis.\n'
    '      </div>\n'
    '\n'
    '      <div id="gamesList" class="games-list"></div>\n'
    '    </div>'
)

if old_search in html:
    html = html.replace(old_search, new_search, 1)
    print("unified search panel")
elif "Pesquisa" in html and "quickFilterInput" in html:
    print("search already unified")
else:
    print("WARN: search pattern not found")

html = html.replace('<div class="card-eyebrow">Mercado recomendado</div>', '<div class="card-eyebrow">★ Mercado recomendado</div>', 1)
html = html.replace('<h3>Resumo da análise</h3>', '<h3>Resumo</h3>', 1)
html = html.replace('<h3>Confidence score</h3>', '<h3>Confidence Score</h3>', 1)

if "Confrontação" not in html:
    html = html.replace(
        '      <div class="card fixture-card">\n        <div class="fixture-teams">',
        '      <div class="card fixture-card">\n        <h3 style="margin-bottom:4px;">Confrontação</h3>\n        <div class="fixture-teams">',
        1,
    )
    print("fixture label")

old_gauge = (
    '      <div class="gauge-wrap">\n'
    '        <svg viewBox="0 0 120 120">\n'
    '          <circle class="gauge-track" cx="60" cy="60" r="50"></circle>\n'
    '          <circle class="gauge-value" id="gaugeCircle" cx="60" cy="60" r="50"\n'
    '            stroke-dasharray="0 314"></circle>\n'
    '        </svg>'
)
new_gauge = (
    '      <div class="gauge-wrap">\n'
    '        <svg viewBox="0 0 120 120">\n'
    '          <defs>\n'
    '            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">\n'
    '              <stop offset="0%" stop-color="#22c55e"/>\n'
    '              <stop offset="70%" stop-color="#4ade80"/>\n'
    '              <stop offset="100%" stop-color="#f4c95d"/>\n'
    '            </linearGradient>\n'
    '          </defs>\n'
    '          <circle class="gauge-track" cx="60" cy="60" r="50"></circle>\n'
    '          <circle class="gauge-value" id="gaugeCircle" cx="60" cy="60" r="50"\n'
    '            stroke-dasharray="0 314"></circle>\n'
    '        </svg>'
)
if old_gauge in html:
    html = html.replace(old_gauge, new_gauge, 1)
    print("gauge gradient")
elif "gaugeGradient" in html:
    print("gauge already patched")

# --- Fixture resolve: reuse sports snapshot + pass context (free plan) ---
if "sportsItem" not in html:
    html = html.replace(
        'async function loadFixture(id, provider = "sportmonks"){\n  const response = await fetch("/api/fixture?id=" + encodeURIComponent(id) + "&provider=" + encodeURIComponent(provider));',
        'async function loadFixture(id, provider = "api-football", context = {}){\n  const cached = context?.sportsItem || window.greenEngineFixtureContexts?.[String(id)]?.sportsItem;\n  if (cached && (cached.id || cached.fixture_id)) {\n    setApiStatus(true);\n    const fixture = cached;\n    const homeGuess = fixture.home?.name || String(fixture.name || "").split(/\\s+vs\\s+/i)[0] || "—";\n    const awayGuess = fixture.away?.name || (String(fixture.name || "").split(/\\s+vs\\s+/i)[1] || "—");\n    $("fixtureHomeName").textContent = homeGuess;\n    $("fixtureAwayName").textContent = awayGuess;\n    $("homeCrest").textContent = initials(homeGuess);\n    $("awayCrest").textContent = initials(awayGuess);\n    $("summaryGame").textContent = fixture.name || (`${homeGuess} vs ${awayGuess}`);\n    $("summaryLeague").textContent = fixture.league?.name || "—";\n    const rawDate = fixture.starting_at || fixture.date;\n    let fixtureDateBR = "—";\n    if (rawDate) { try { fixtureDateBR = new Date(String(rawDate)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }); } catch { fixtureDateBR = String(rawDate).slice(0, 16); } }\n    $("summaryDate").textContent = fixtureDateBR;\n    $("fixtureMeta").textContent = [fixture.league?.name, fixtureDateBR].filter(Boolean).join(" · ");\n    return fixture;\n  }\n  const qs = new URLSearchParams({ id: String(id), provider: String(provider) });\n  if (context?.date) qs.set("date", String(context.date).slice(0, 10));\n  if (context?.home) qs.set("home", context.home);\n  if (context?.away) qs.set("away", context.away);\n  const response = await fetch("/api/fixture?" + qs.toString());'
    )
    html = html.replace(
        'async function loadHistory(id, provider = "sportmonks"){\n  const response = await fetch("/api/history?fixture=" + encodeURIComponent(id) + "&provider=" + encodeURIComponent(provider));',
        'async function loadHistory(id, provider = "api-football", context = {}){\n  const qs = new URLSearchParams({ fixture: String(id), provider: String(provider) });\n  if (context?.date) qs.set("date", String(context.date).slice(0, 10));\n  if (context?.home) qs.set("home", context.home);\n  if (context?.away) qs.set("away", context.away);\n  const response = await fetch("/api/history?" + qs.toString());'
    )
    html = html.replace(
        '    await loadFixture(String(id), provider);\n    await loadHistory(String(id), provider);',
        '    const context = event.detail?.context || window.greenEngineFixtureContexts?.[String(id)] || {};\n    await loadFixture(String(id), provider, context);\n    await loadHistory(String(id), provider, context);'
    )
    html = html.replace(
        'const provider = String(event.detail?.provider || "sportmonks").toLowerCase();',
        'const provider = String(event.detail?.provider || "api-football").toLowerCase();'
    )
    print("fixture context patches applied")
else:
    print("fixture context already present")

p.write_text(html, encoding="utf-8")
print("wrote", p.stat().st_size)
