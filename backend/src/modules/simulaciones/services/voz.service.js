const { tokenGeminiLive } = require("../../../shared/voz/gemini-live");
const { logLinea } = require("../../../shared/utils/registro");
const { costoLive, textoUsd } = require("../../../shared/utils/precios");
const { llamadaTerminada } = require("../../../shared/utils/costo-simulacion");

// Token efímero para Gemini Live: el navegador se conecta directo a Google con esto
// (sin pasar el audio por nuestro servidor) y la GEMINI_API_KEY no sale de acá.
// pedido: {descartar, motivo} cuando la key anterior falló en el navegador.
async function token(pedido) {
  const r = await tokenGeminiLive({
    descartar: Number.isInteger(pedido.descartar) ? pedido.descartar : undefined,
    motivo: typeof pedido.motivo === "string" ? pedido.motivo.slice(0, 160) : ""
  });
  const maxMinutos = Math.min(60, Math.max(1, Number(process.env.CALL_MAX_MINUTES) || 15));
  return r.error ? r : { ...r, maxMinutos };
}

// Línea en la terminal y en data/logs/ia-AAAA-MM-DD.log con lo que gastó una llamada de Gemini Live.
function registrarUso(d, usuario) {
  const n = k => Math.max(0, Math.round(Number(d[k]) || 0));
  const modelo = String(d.modelo || "?").replace(/[^\w.\-]/g, "").slice(0, 60);
  const partes = [`[VOZ] gemini-live`, modelo, "llamada"];
  if (d.segundos != null) partes.push(`${n("segundos")}s`);
  if (usuario) partes.push(`usuario=${String(usuario.nombre || usuario.id || "?").replace(/[^\w.\-@ ]/g, "").slice(0, 40)}`);
  partes.push(`${n("turnos")} turnos`);
  partes.push(`tokens in=${n("entrada")} (texto=${n("entradaTexto")} audio=${n("entradaAudio")}) out=${n("salida")} (audio=${n("salidaAudio")} texto=${n("salidaTexto")}) pensamiento=${n("pensamiento")}`);
  const costo = costoLive(modelo, d);
  if (costo) partes.push(`costo=${textoUsd(costo.total)} (entrada ${textoUsd(costo.entrada)} + salida ${textoUsd(costo.salida)})`);
  logLinea(partes.join(" · "));
  if (typeof d.simulacion === "string" && /^[\w-]{1,40}$/.test(d.simulacion)) llamadaTerminada(d.simulacion, costo ? costo.total : null);
}

module.exports = { token, registrarUso };
