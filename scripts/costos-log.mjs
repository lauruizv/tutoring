// Agrega el costo en dólares a las líneas de un log de la IA que todavía no lo tienen y muestra los totales.
//   npm run costos                      → el log de hoy (data/logs/ia-AAAA-MM-DD.log)
//   npm run costos -- ruta/al.log       → otro archivo
//   npm run costos -- --solo-resumen    → no toca el archivo, solo cuenta
// Antes de reescribir deja una copia en <archivo>.bak (si ya existe, no la pisa).
// Los precios están en backend/src/shared/utils/precios.js.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { costoLive, costoClaude, textoUsd } = require("../backend/src/shared/utils/precios");
const { textoCosto } = require("../backend/src/shared/llm/log");
const { LOGS } = require("../backend/src/config/paths");

const args = process.argv.slice(2);
const soloResumen = args.includes("--solo-resumen");
const d = new Date();
const hoy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const archivo = args.find(a => !a.startsWith("--")) || path.join(LOGS, `ia-${hoy}.log`);
if (!fs.existsSync(archivo)) { console.error("No existe " + archivo); process.exit(1); }

const n = s => Number(s) || 0;
const lineas = fs.readFileSync(archivo, "utf8").split("\n");
const t = { llamadas: 0, voz: 0, vozSeg: 0, informes: 0, claude: 0, claudeApi: 0, sinPrecio: 0 };
const detalle = [];

const salida = lineas.map(linea => {
  const ya = linea.match(/costo(?: equivalente por API)?[ =]US\$([\d.]+)/);
  // --- llamada de voz ---
  const v = linea.match(/\[VOZ\] gemini-live · ([^ ]+) · llamada · (?:(\d+)s · )?.*tokens in=(\d+) \(texto=(\d+) audio=(\d+)\) out=(\d+) \(audio=(\d+) texto=(\d+)\) pensamiento=(\d+)/);
  if (v) {
    const c = costoLive(v[1], { entrada: n(v[3]), entradaTexto: n(v[4]), entradaAudio: n(v[5]), salida: n(v[6]), salidaAudio: n(v[7]), salidaTexto: n(v[8]), pensamiento: n(v[9]) });
    if (!c) { t.sinPrecio++; return linea; }
    t.llamadas++; t.voz += c.total; t.vozSeg += n(v[2]);
    detalle.push(`${linea.slice(0, 8)}  voz      ${String(n(v[2])).padStart(4)}s  ${textoUsd(c.total)}`);
    return ya ? linea : `${linea} · costo=${textoUsd(c.total)} (entrada ${textoUsd(c.entrada)} + salida ${textoUsd(c.salida)})`;
  }
  // --- consulta a Claude (informes y mentor) ---
  const i = linea.match(/\[IA\](?: #\w+)? (claude-sdk|anthropic) · ([^ ]+) · (\w+) .*tokens in=(\d+)(?: \(normales=\d+ caché: escritos=(\d+) leídos=(\d+),[^)]*\))? out=(\d+)/);
  if (i) {
    const c = costoClaude(i[2], { in: n(i[4]), out: n(i[7]), cacheWrite: n(i[5]), cacheRead: n(i[6]) });
    if (c == null) { t.sinPrecio++; return linea; }
    if (i[3] === "eval" && / · ok · /.test(linea)) t.informes++;   // los intentos fallidos cuestan, pero no son informes
    t.claude += c; if (i[1] === "anthropic") t.claudeApi += c;
    detalle.push(`${linea.slice(0, 8)}  ${i[3].padEnd(8)} ${i[1].padEnd(10)} ${textoUsd(c)}`);
    return ya ? linea : `${linea} · ${textoCosto(c, i[1])}`;
  }
  return linea;
});

// --- líneas [SIM] de logs viejos: sin id de simulación, se une el informe con la llamada que terminó a la vez ---
const seg = l => { const m = l.match(/^(\d\d):(\d\d):(\d\d)/); return m ? n(m[1]) * 3600 + n(m[2]) * 60 + n(m[3]) : null; };
const usdDe = l => { const m = l.match(/costo(?: equivalente por API)?[ =]US\$([\d.]+)/); return m ? Number(m[1]) : null; };
const conSim = new Set(salida.flatMap(l => { const m = l.match(/\[SIM\] #(\w+)/); return m ? [m[1]] : []; }));
const usadas = new Set();
const completo = [];
salida.forEach(linea => {
  completo.push(linea);
  const fin = linea.match(/\[IA\] #(\w+) ✓ evaluación lista/);
  if (!fin || conSim.has(fin[1])) return;
  const req = fin[1];
  const inicio = salida.find(l => l.includes(`#${req} evaluación:`));
  const intentos = salida.filter(l => l.includes(`#${req} `) && usdDe(l) != null);
  const llamadaIdx = inicio == null ? -1 : salida.findIndex((l, i) => l.includes("[VOZ]") && !usadas.has(i) && Math.abs(seg(l) - seg(inicio)) <= 5);
  if (llamadaIdx < 0 || !intentos.length) return;
  usadas.add(llamadaIdx);
  const llamada = usdDe(salida[llamadaIdx]), informe = intentos.reduce((a, l) => a + usdDe(l), 0);
  const nota = intentos.some(l => l.includes("claude-sdk")) ? " · el informe es equivalente por API: con la suscripción no se paga por token" : "";
  completo.push(`${linea.slice(0, 8)} [SIM] #${req} simulación · llamada ${textoUsd(llamada)} + informe ${textoUsd(informe)} = total ${textoUsd(llamada + informe)}${nota}`);
});
salida.length = 0; salida.push(...completo);

if (!soloResumen && salida.join("\n") !== lineas.join("\n")) {
  if (!fs.existsSync(archivo + ".bak")) fs.copyFileSync(archivo, archivo + ".bak");
  fs.writeFileSync(archivo, salida.join("\n"));
  console.log(`Log actualizado: ${archivo} (copia original en ${path.basename(archivo)}.bak)\n`);
}
console.log(detalle.join("\n") + "\n");
const sims = salida.filter(l => l.includes("[SIM]"));
if (sims.length) console.log(sims.map(l => l.replace(/ · el .*$/, "")).join("\n") + "\n");
console.log(`Llamadas de voz (Gemini Live): ${t.llamadas} · ${t.vozSeg}s · ${textoUsd(t.voz)}` + (t.llamadas ? ` (${textoUsd(t.voz / t.llamadas)} por llamada, ${textoUsd(t.vozSeg ? t.voz / t.vozSeg * 60 : 0)} por minuto)` : ""));
console.log(`Consultas a Claude (informes y mentor): ${textoUsd(t.claude)} equivalentes por API · de eso, pagado de verdad por la API: ${textoUsd(t.claudeApi)}`);
console.log(`Informes generados: ${t.informes}`);
console.log(`Total si todo se pagara por API: ${textoUsd(t.voz + t.claude)}  ·  gasto si la key de Gemini es de pago (voz + Claude por API): ${textoUsd(t.voz + t.claudeApi)}`);
if (t.sinPrecio) console.log(`(${t.sinPrecio} líneas sin precio cargado para su modelo, no se sumaron.)`);
