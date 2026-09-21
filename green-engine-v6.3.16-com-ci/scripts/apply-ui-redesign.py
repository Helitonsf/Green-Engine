#!/usr/bin/env python3
"""Apply UI redesign + history-lazy + odds column patches to public/index.html in CI."""
from pathlib import Path

p = Path("public/index.html")
if not p.exists():
    print("public/index.html missing")
    raise SystemExit(0)

html = p.read_text(encoding="utf-8")

# Provider defaults
html = html.replace('provider = "sportmonks"', 'provider = "auto"')
html = html.replace('|| "sportmonks"', '|| "auto"')
html = html.replace('provider = "api-football"', 'provider = "auto"')
html = html.replace('|| "api-football"', '|| "auto"')

# Odds columns in markets table
_old_odds_row = """    return `
      <tr>
        <td class=\"market-name\">${escapeHtml(m.market)}</td>
        <td>${pct(m.probability)}</td>
        <td class=\"muted\">—</td>
        <td>${oddJusta}</td>
        <td class=\"muted\">—</td>
        <td class=\"muted\">—</td>
        <td><span class=\"badge-pill ${confidenceBadgeClass(confidenceLabel)}\">${escapeHtml(String(confidenceLabel).toUpperCase())}</span></td>
        <td>${recBadge}</td>
      </tr>
    `;"""
_new_odds_row = """    const implied = Number(m.impliedProbability);
    const oddAtual = Number(m.odd);
    const valueEdge = Number(m.valueEdge);
    const impliedCell = Number.isFinite(implied)
      ? pct(implied)
      : '<span class=\"muted\">—</span>';
    const oddAtualCell = Number.isFinite(oddAtual)
      ? oddAtual.toFixed(2)
      : '<span class=\"muted\">—</span>';
    let valueCell = '<span class=\"muted\">—</span>';
    if (Number.isFinite(valueEdge)) {
      const cls = valueEdge > 0.05 ? 'badge-apostar' : valueEdge < -0.05 ? 'badge-evitar' : 'badge-neutro';
      valueCell = `<span class=\"badge-pill ${cls}\">${(valueEdge * 100).toFixed(1)}%</span>`;
    }

    return `
      <tr>
        <td class=\"market-name\">${escapeHtml(m.market)}</td>
        <td>${pct(m.probability)}</td>
        <td>${impliedCell}</td>
        <td>${oddJusta}</td>
        <td>${oddAtualCell}</td>
        <td>${valueCell}</td>
        <td><span class=\"badge-pill ${confidenceBadgeClass(confidenceLabel)}\">${escapeHtml(String(confidenceLabel).toUpperCase())}</span></td>
        <td>${recBadge}</td>
      </tr>
    `;"""
if _old_odds_row in html:
    html = html.replace(_old_odds_row, _new_odds_row, 1)
    print("odds columns patched in markets table")
html = html.replace(
    "Prob. Implícita, Odd Atual e Valor dependem de uma fonte de odds — ainda não conectada nesta versão.",
    "Prob. Implícita, Odd Atual e Valor vêm da API-Football /odds (quando disponível para o fixture). Valor = Prob.Modelo × Odd − 1.",
)

# loadHistory 429 status
_old_lh = "  if(!response.ok || data.error){\n    setApiStatus(false);\n    throw new Error(data.error || \"Falha na consulta do histórico\");\n  }"
_new_lh = "  if(!response.ok || data.error){\n    setApiStatus(false);\n    const err = new Error(data.error || \"Falha na consulta do histórico\");\n    err.status = response.status;\n    err.retryable = response.status === 429 || /limite|rate\\s*limit|too many/i.test(String(data.error || \"\"));\n    throw err;\n  }"
if _old_lh in html and "err.status = response.status" not in html:
    html = html.replace(_old_lh, _new_lh, 1)
    print("loadHistory 429 status preserved")

html = html.replace(
    'async function loadHistory(id, provider = "api-football", context = {})',
    'async function loadHistory(id, provider = "auto", context = {})',
)
html = html.replace(
    'async function loadFixture(id, provider = "api-football", context = {})',
    'async function loadFixture(id, provider = "auto", context = {})',
)
html = html.replace(
    'const provider = String(event.detail?.provider || "api-football").toLowerCase();',
    'const provider = String(event.detail?.provider || "auto").toLowerCase();',
)

p.write_text(html, encoding="utf-8")
print("wrote", p.stat().st_size)
