// Costos del log: precios cargados y script que completa un log viejo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { costoLive, costoClaude } = require("../backend/src/shared/utils/precios");

test("Gemini Live: separa texto, audio y pensamiento", () => {
  const c = costoLive("gemini-3.8-live", { entrada: 2400, entradaTexto: 1500, entradaAudio: 900, salida: 310, salidaAudio: 300, salidaTexto: 10, pensamiento: 120 });
  assert.deepEqual(c, { total: 0.00801, entrada: 0.003825, salida: 0.004185 });
});

test("Gemini Live: un modelo sin precio cargado no inventa un costo", () => {
  assert.equal(costoLive("gemini-test-live", { entrada: 100 }), null);
});

test("Claude: el caché se cobra aparte y los alias resuelven al modelo", () => {
  const t = { in: 1000, cacheWrite: 600, cacheRead: 300, out: 100 };   // 100 normales
  const esperado = (100 * 2 + 600 * 2.5 + 300 * 0.2 + 100 * 10) / 1e6;
  assert.ok(Math.abs(costoClaude("sonnet", t) - esperado) < 1e-9);
  assert.equal(costoClaude("sonnet", t), costoClaude("claude-sonnet-5-5", t));
  assert.equal(costoClaude("claude-haiku-4-5-20251001", { in: 1e6, out: 0 }), 1);
  assert.equal(costoClaude("modelo-raro", t), null);
});

test("costos-log completa el log, deja copia y no duplica si se corre dos veces", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutoring-costos-"));
  const log = path.join(dir, "ia.log");
  fs.writeFileSync(log, [
    "22:05:38 [VOZ] gemini-live · gemini-3.8-live · llamada · 20s · usuario=X · 2 turnos · tokens in=2400 (texto=1500 audio=900) out=310 (audio=300 texto=10) pensamiento=120",
    "22:37:08 [IA] #a281 claude-sdk · sonnet · eval · 26.4s · ok · tokens in=1000 (normales=100 caché: escritos=600 leídos=300, 30% cacheado) out=100",
    "22:58:11 [IA] #00b8 claude-sdk · sonnet · eval · 32.4s · tokens in=1000 (normales=100 caché: escritos=600 leídos=300, 30% cacheado) out=100 · ERROR 502 eval_formato: x",
    ""
  ].join("\n"));
  const correr = () => execFileSync(process.execPath, ["scripts/costos-log.mjs", log], { encoding: "utf8" });
  const salida = correr();
  const una = fs.readFileSync(log, "utf8");
  assert.match(una, /costo=US\$0\.0080 \(entrada US\$0\.0038 \+ salida US\$0\.0042\)/);
  assert.match(una, /costo equivalente por API US\$0\.0028/);
  assert.match(salida, /Informes generados: 1/, "el intento fallido no cuenta como informe");
  assert.ok(fs.existsSync(log + ".bak"));
  correr();
  assert.equal(fs.readFileSync(log, "utf8"), una);
});

test("costos-log une la llamada con su informe y suma los intentos fallidos", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutoring-costos-"));
  const log = path.join(dir, "ia.log");
  fs.writeFileSync(log, [
    "22:57:39 [VOZ] gemini-live · gemini-3.8-live · llamada · 139s · usuario=X · 2 turnos · tokens in=2400 (texto=1500 audio=900) out=310 (audio=300 texto=10) pensamiento=120",
    "22:57:39 [IA] #00b8 evaluación: cadena claude-sdk → gemini",
    "22:58:11 [IA] #00b8 claude-sdk · sonnet · eval · 32.4s · tokens in=1000 (normales=100 caché: escritos=600 leídos=300, 30% cacheado) out=100 · ERROR 502 eval_formato: x",
    "22:58:33 [IA] #00b8 claude-sdk · sonnet · eval · 26.9s · ok · tokens in=1000 (normales=100 caché: escritos=600 leídos=300, 30% cacheado) out=100",
    "22:58:33 [IA] #00b8 ✓ evaluación lista con Claude (tu suscripción) en 53.8s",
    ""
  ].join("\n"));
  const correr = () => execFileSync(process.execPath, ["scripts/costos-log.mjs", log], { encoding: "utf8" });
  correr();
  const una = fs.readFileSync(log, "utf8");
  assert.match(una, /\[SIM\] #00b8 simulación · llamada US\$0\.0080 \+ informe US\$0\.0056 = total US\$0\.0136/);
  correr();
  assert.equal(fs.readFileSync(log, "utf8"), una, "no repite la línea [SIM]");
});

test("el costo de una simulación se escribe cuando llegan llamada e informe, en cualquier orden", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutoring-sim-"));
  process.env.DATA_DIR = dir;
  const { llamadaTerminada, intentoDeInforme, informeTerminado } = require("../backend/src/shared/utils/costo-simulacion");
  const lineas = [];
  const original = console.log;
  console.log = t => lineas.push(String(t));
  try {
    // Primero el informe, con un intento fallido y otro bueno.
    intentoDeInforme("r1", 0.02, true);
    intentoDeInforme("r1", 0.03, true);
    informeTerminado("r1", "sim-1", true);
    assert.equal(lineas.length, 0, "falta la llamada");
    llamadaTerminada("sim-1", 0.1);
    // Primero la llamada; el informe falla, y sale recién con el Reintentar.
    llamadaTerminada("sim-2", 0.2);
    intentoDeInforme("r2", 0.01, false);
    informeTerminado("r2", "sim-2", false);
    assert.equal(lineas.length, 1);
    intentoDeInforme("r3", null, false);
    informeTerminado("r3", "sim-2", true);
  } finally { console.log = original; }
  assert.match(lineas[0], /\[SIM\] #r1 simulación · llamada US\$0\.1000 \+ informe US\$0\.0500 = total US\$0\.1500 · el informe es equivalente por API/);
  assert.match(lineas[1], /\[SIM\] #r3 simulación · llamada US\$0\.2000 \+ informe US\$0\.0100 \(una parte sin precio\) = total US\$0\.2100 · el total no incluye/);
});
