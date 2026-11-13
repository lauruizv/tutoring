// Reglas de los informes de simulaciones: quién ve cuáles y qué tiene que traer uno para guardarse.
// No sabe de HTTP (eso es del controlador) ni de archivos (eso es del repositorio).
const crypto = require("crypto");
const { isObj } = require("../../../shared/utils/validacion");
const repo = require("../repositories/informes.repository");
const { exportarInformes } = require("../exportar");
const { loVe, alcanceDe } = require("../informes/permisos");
const { consentimientoDe } = require("../informes/audio-reglas");
const audios = require("./audios.service");


// Resúmenes de los informes que `yo` puede ver y que pasan el filtro (ver informes/filtro.js).
const listar = (yo, filtro) => repo.listarResumenes(filtro, alcanceDe(yo));

// Candidatos y simulaciones que existen, para los desplegables de los filtros.
const opciones = (yo, filtro) => repo.listarOpciones(alcanceDe(yo), filtro);

// El listado filtrado como archivo (Excel o PDF). El exportador no sabe de dónde salen los informes:
// recibe una función que se los trae, ya con el filtro y el alcance de quien exporta.
// Devuelve { nombre, tipoMime, contenido, cantidad }; si el formato o la zona no valen, tira un error
// con code "exportacion_invalida".
const exportar = (yo, filtro, { formato, zona }) => exportarInformes({
  formato, zona, filtro,
  obtenerResumenes: () => repo.listarResumenes(filtro, alcanceDe(yo))
});

// Devuelve { error: { status, message } } o { id }.
async function crear(r, yo) {
  // El nombre sale de la sesión, no de lo que manda el navegador. Los scripts locales lo traen en el pedido.
  if (!yo.local) { r.candidato = yo.nombre; r.usuarioId = yo.id; }
  if (typeof r.candidato !== "string" || !r.candidato.trim()) return { error: { status: 400, message: "El informe no tiene candidato." } };
  if (!isObj(r.evaluacion)) return { error: { status: 400, message: "El informe no trae la evaluación." } };
  // La aceptación de la grabación queda con la fecha del servidor. El dato del audio no lo manda el navegador:
  // lo anota el servidor recién cuando llega el archivo (ver audios.service.js).
  if ("consentimientoAudio" in r) {
    const consentimiento = consentimientoDe(r.consentimientoAudio);
    if (consentimiento) r.consentimientoAudio = consentimiento; else delete r.consentimientoAudio;
  }
  delete r.audio;
  r.id = crypto.randomUUID();
  if (!r.fecha) r.fecha = new Date().toISOString();
  try { await repo.guardar(r); }
  catch (_) { return { error: { status: 500, message: "No se pudo escribir el informe en data/informes." } }; }
  return { id: r.id };
}

// Devuelve { informe } o { error: { status, message } }.
async function obtener(id, yo, sinPermiso) {
  const r = await repo.leer(id);
  if (!r) return { error: { status: 404, message: "El informe no existe" } };
  return loVe(yo, r) ? { informe: r } : { error: { status: 403, message: sinPermiso } };
}

// Devuelve {} o { error: { status, message } }.
// Primero el audio: si algo falla a la mitad, que no quede una grabación sin su informe.
async function borrar(id) {
  try { await audios.borrarDe(id); }
  catch (_) { return { error: { status: 500, message: "No se pudo eliminar el audio del informe" } }; }
  try { await repo.borrar(id); }
  catch (_) { return { error: { status: 500, message: "No se pudo eliminar el informe" } }; }
  return {};
}

module.exports = { listar, opciones, exportar, crear, obtener, borrar };
