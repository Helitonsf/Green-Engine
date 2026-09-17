#!/usr/bin/env bash
# Garante namespace KV green-engine-history e injeta binding HISTORY_KV no wrangler.toml.
set -euo pipefail

NS_TITLE="green-engine-history"
TOML="wrangler.toml"

if [[ ! -f "$TOML" ]]; then
  echo "wrangler.toml nao encontrado"
  exit 1
fi

echo ">> Listando KV namespaces..."
LIST_JSON=$(npx wrangler kv namespace list --json 2>/dev/null || echo "[]")
export LIST_JSON

NS_ID=$(python3 - <<'PY'
import json, os
raw = os.environ.get("LIST_JSON") or "[]"
try:
    data = json.loads(raw)
except Exception:
    data = []
if not isinstance(data, list):
    data = []
for item in data:
    if str(item.get("title") or item.get("name") or "") == "green-engine-history":
        print(item.get("id") or "")
        break
PY
)

if [[ -z "${NS_ID}" ]]; then
  echo ">> Criando namespace $NS_TITLE..."
  CREATE_OUT=$(npx wrangler kv namespace create "$NS_TITLE" 2>&1 || true)
  echo "$CREATE_OUT"
  NS_ID=$(echo "$CREATE_OUT" | python3 -c 'import sys,re; t=sys.stdin.read(); m=re.search(r"id\s*[:=]\s*[\"\x27]?([a-f0-9]{32})", t, re.I) or re.search(r"([a-f0-9]{32})", t); print(m.group(1) if m else "")')
fi

if [[ -z "${NS_ID}" ]]; then
  echo "WARN: nao foi possivel obter id do KV; deploy segue sem HISTORY_KV"
  exit 0
fi

echo ">> HISTORY_KV id=$NS_ID"
export NS_ID

python3 - <<'PY'
from pathlib import Path
import os, re
ns_id = os.environ["NS_ID"]
toml = Path("wrangler.toml")
text = toml.read_text(encoding="utf-8")
block = f'\n[[kv_namespaces]]\nbinding = "HISTORY_KV"\nid = "{ns_id}"\npreview_id = "{ns_id}"\n'
lines = text.splitlines(keepends=True)
i = 0
out = []
while i < len(lines):
    line = lines[i]
    if line.strip().startswith("[[kv_namespaces]]"):
        i += 1
        while i < len(lines):
            s = lines[i].strip()
            if s.startswith("[") and not s.startswith("[[kv"):
                break
            if s.startswith("[["):
                break
            i += 1
        continue
    out.append(line)
    i += 1
text = "".join(out).rstrip() + "\n" + block
toml.write_text(text, encoding="utf-8")
print("wrangler.toml atualizado com HISTORY_KV")
PY
