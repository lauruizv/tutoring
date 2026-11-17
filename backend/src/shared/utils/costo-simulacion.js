const { logLinea } = require("./registro");
const { textoUsd } = require("./precios");

// Une el costo de una llamada con el de su informe. Son dos pedidos separados del navegador (y pueden
// llegar en cualquier orden), así que los dos traen el mismo id de simulación. Cuando están los dos
// escribe en el log la línea [SIM] con la llamada, el informe y la suma.
// Vive en memoria: si el servidor se reinicia en el medio, esa simulación queda sin línea [SIM].
const VIDA_MS = 2 * 60 * 60 * 1000;
const simulaciones = new Map();   // id de simulación -> { llamada, informe, sinPrecio, suscripcion, listo, req, t }
const evaluaciones = new Map();   // id del pedido de evaluación -> gasto de sus intentos

function limpiar() {
  const limite = Date.now() - VIDA_MS;
  for (const mapa of [simulaciones, evaluaciones]) for (const [k, v] of mapa) if (v.t < limite) mapa.delete(k);
}
function entrada(id) {
  if (!simulaciones.has(id)) simulaciones.set(id, { llamada: undefined, informe: 0, sinPrecio: false, suscripcion: false, listo: false, req: "", t: Date.now() });
  return simulaciones.get(id);
}
function quizasEscribir(id) {
  const s = simulaciones.get(id);
  if (!s || !s.listo || s.llamada === undefined) return;
  simulaciones.delete(id);
  const llamada = s.llamada == null ? "sin precio" : textoUsd(s.llamada);
  const informe = textoUsd(s.informe) + (s.sinPrecio ? " (una parte sin precio)" : "");
  const total = (s.llamada || 0) + s.informe;
  const notas = [
    s.suscripcion ? "el informe es equivalente por API: con la suscripción no se paga por token" : "",
    s.llamada == null || s.sinPrecio ? "el total no incluye lo que no tiene precio" : ""
  ].filter(Boolean);
  logLinea(`[SIM]${s.req ? " #" + s.req : ""} simulación · llamada ${llamada} + informe ${informe} = total ${textoUsd(total)}${notas.length ? " · " + notas.join(" · ") : ""}`);
}

// usd: costo de la llamada, o null si su modelo no tiene precio cargado.
function llamadaTerminada(id, usd) {
  if (!id) return;
  limpiar();
  entrada(id).llamada = usd;
  quizasEscribir(id);
}

// Un intento de evaluación que gastó tokens, haya salido bien o no. usd null = modelo sin precio.
function intentoDeInforme(req, usd, suscripcion) {
  if (!req) return;
  const g = evaluaciones.get(req) || { usd: 0, sinPrecio: false, suscripcion: false, t: Date.now() };
  if (usd == null) g.sinPrecio = true; else g.usd += usd;
  if (suscripcion) g.suscripcion = true;
  evaluaciones.set(req, g);
}

// Terminó la evaluación. Si falló, lo gastado se suma igual y queda esperando el Reintentar del usuario.
function informeTerminado(req, id, ok) {
  const g = evaluaciones.get(req);
  evaluaciones.delete(req);
  if (!id) return;
  limpiar();
  const s = entrada(id);
  if (g) { s.informe += g.usd; s.sinPrecio = s.sinPrecio || g.sinPrecio; s.suscripcion = s.suscripcion || g.suscripcion; }
  if (ok) { s.listo = true; s.req = req; quizasEscribir(id); }
}

module.exports = { llamadaTerminada, intentoDeInforme, informeTerminado };
