import assert from "node:assert/strict";
import { historyCore } from "../cloudflare/history-core.js";

console.log("=== TESTE 1 — SEM TOKEN ===");

const result1 = await historyCore(
  "19722813",
  ""
);

console.log(JSON.stringify(result1, null, 2));

console.log("");
console.log("=== TESTE 2 — ID INVÁLIDO ===");

const result2 = await historyCore(
  "abc",
  ""
);

console.log(JSON.stringify(result2, null, 2));

console.log("");
console.log("=== TESTE 3 — ID AUSENTE ===");

const result3 = await historyCore(
  null,
  ""
);

console.log(JSON.stringify(result3, null, 2));

// A checagem de token acontece antes da checagem de ID, então mesmo os
// casos "ID inválido"/"ID ausente" retornam 500 (token) enquanto o token
// estiver vazio — é o comportamento real, não um bug deste teste.
assert.equal(result1.statusCode, 500, "sem token deveria retornar 500");
assert.equal(result2.statusCode, 500, "sem token (ID inválido) deveria retornar 500");
assert.equal(result3.statusCode, 500, "sem token (ID ausente) deveria retornar 500");
assert.match(result1.body.error, /SPORTMONKS_API_TOKEN/, "mensagem deveria citar o token ausente");

console.log("\n✅ test-history-core: todos os asserts passaram.");
