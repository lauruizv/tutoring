// Reglas del audio de las simulaciones: quién lo sube, quién lo escucha y cuándo se borra.
// No sabe de HTTP (eso es del controlador) ni de dónde se guardan los archivos (eso es de los repositorios).
const { AUDIO_DIAS } = require("../../../config/limits");
const { safeId } = require("../../../shared/utils/validacion");
const informes = require("../repositories/informes.repository");
const audios = require("../repositories/audios.repository");
const { loVe } = require("../informes/permisos");
const { aceptoGrabar, tieneAudio, audioVencido, duracionValida } = require("../informes/audio-reglas");

const error = (status, message) => ({ error: { status, message } });

// Borra el audio de un informe y deja anotado en el informe cuándo y por qué ya no está.
async function borrarPorVencimiento(informe) {
  await audios.borrar(informe.id);
  informe.audio = { borrado: new Date().toISOString(), motivo: "vencimiento" };
  await informes.guardar(informe);
}

// ¿Puede `yo` subir el audio de este informe? Se pregunta antes de leer el archivo que manda el navegador.
// Lo sube solo quien hizo la simulación, una sola vez y solo si en el informe consta que aceptó.
// Devuelve { informe } o { error: { status, message } }.
async function permisoParaSubir(id, yo, sinPermiso) {
  const informe = await informes.leer(id);
  if (!informe) return error(404, "El informe no existe");
  if (!informe.usuarioId || informe.usuarioId !== yo.id) return error(403, sinPermiso);
  if (!aceptoGrabar(informe)) return error(403, "En este informe no consta que se aceptó la grabación: el audio no se guarda.");
  if (informe.audio) return error(409, "Este informe ya tiene su audio.");
  return { informe };
}

// Guarda el audio y lo anota en el informe. El dato `audio` del informe lo escribe solo el servidor.
// Devuelve { audio } o { error: { status, message } }.
async function guardar(informe, contenido, duracion) {
  const guardado = await audios.guardar(informe.id, contenido);
  if (!guardado) return error(415, "El archivo no es un audio que la app sepa guardar.");
  informe.audio = { mime: guardado.mime, bytes: guardado.bytes, duracionSeg: duracionValida(duracion), subido: new Date().toISOString() };
  try { await informes.guardar(informe); }
  catch (_) {
    await audios.borrar(informe.id);   // sin la anotación en el informe, el audio quedaría suelto
    return error(500, "No se pudo anotar el audio en el informe.");
  }
  return { audio: informe.audio };
}

// El audio de un informe, para quien puede ver ese informe.
// Devuelve { audio: { contenido, mime, bytes } } o { error: { status, message } }.
async function obtener(id, yo, sinPermiso) {
  const informe = await informes.leer(id);
  if (!informe) return error(404, "El informe no existe");
  if (!loVe(yo, informe)) return error(403, sinPermiso);
  // Un audio vencido no se entrega aunque la limpieza diaria todavía no haya pasado: se borra en el momento.
  if (audioVencido(informe.audio, Date.now(), AUDIO_DIAS)) await borrarPorVencimiento(informe);
  const audio = tieneAudio(informe) ? await audios.abrir(informe.id) : null;
  if (audio) return { audio };
  const yaSeBorro = Boolean(informe.audio && informe.audio.borrado);
  return error(404, yaSeBorro ? `El audio de esta simulación ya se borró: se guarda ${AUDIO_DIAS} días.` : "Este informe no tiene audio.");
}

// Al borrar un informe se borra también su grabación.
const borrarDe = id => audios.borrar(id);

// Limpieza: borra los audios que cumplieron el plazo y los que quedaron sin informe. Devuelve cuántos borró.
async function limpiar() {
  let borrados = 0;
  const conInforme = new Set();
  for (const informe of await informes.listarTodos()) {
    if (!safeId(String(informe.id))) continue;
    conInforme.add(informe.id);
    if (audioVencido(informe.audio, Date.now(), AUDIO_DIAS)) { await borrarPorVencimiento(informe); borrados++; }
  }
  for (const id of await audios.ids()) {
    if (!conInforme.has(id) && await audios.borrar(id)) borrados++;
  }
  return borrados;
}

// Corre la limpieza ahora y una vez por día. `avisar(n)` y `fallo(e)` deciden qué se escribe en la consola.
function programarLimpieza({ avisar, fallo }) {
  const correr = () => limpiar().then(n => { if (n) avisar(n); }).catch(fallo);
  correr();
  setInterval(correr, 24 * 60 * 60 * 1000).unref();   // unref: este reloj no mantiene vivo al servidor
}

module.exports = { permisoParaSubir, guardar, obtener, borrarDe, limpiar, programarLimpieza };
