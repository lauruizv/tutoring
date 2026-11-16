// Reglas de los informes de simulaciones: quién ve cuáles y qué tiene que traer uno para guardarse.
// No sabe de HTTP (eso es del controlador) ni de archivos (eso es del repositorio).
const crypto = require("crypto");
const { isObj } = require("../../../shared/utils/validacion");
const repo = require("../repositories/informes.repository");
const simulaciones = require("./simulaciones.service");
const { exportarInformes } = require("../exportar");
const { loVe, alcanceDe } = require("../informes/permisos");
const { consentimientoDe } = require("../informes/audio-reglas");
const audios = require("./audios.service");


// Resúmenes de los informes que `yo` puede ver y que pasan el filtro (ver informes/filtro.js).
const listar = (yo, filtro) => repo.listarResumenes(filtro, alcanceDe(yo));

// Los últimos `limite` informes de una empresa (los guardados con su empresaId: cuentas de Postgres),
// del más nuevo al más viejo. Los usa el inicio de la empresa. Sin empresaId no devuelve nada.
const SIN_FILTRO = {};
async function recientes(empresaId, limite) {
  if (!empresaId) return [];
  return (await repo.listarResumenes(SIN_FILTRO, { empresaId })).slice(0, limite);
}

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
// Una cuenta de Postgres (yo.empresaId) deja registrada la simulación, con su precio, ANTES de guardar el informe:
// si no se puede registrar no se guarda nada, y si después no se puede guardar el informe, se anula el registro.
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
  // La simulación y la empresa las pone solo el servidor: lo que mande el navegador se descarta.
  delete r.simulacionId;
  delete r.empresaId;
  let simulacionId = null;
  if (yo.empresaId) {
    try { simulacionId = await simulaciones.registrar({ empresaId: yo.empresaId, usuarioId: yo.id, informe: r }); }
    catch (e) {
      console.error("[informes] no se pudo registrar la simulación -", e.message);
      return { error: { status: 503, message: "No se pudo registrar la simulación." } };
    }
    r.simulacionId = simulacionId;
    r.empresaId = yo.empresaId;
  }
  r.id = crypto.randomUUID();
  if (!r.fecha) r.fecha = new Date().toISOString();
  try { await repo.guardar(r); }
  catch (_) {
    if (simulacionId) await simulaciones.anular(simulacionId);
    return { error: { status: 500, message: "No se pudo escribir el informe en data/informes." } };
  }
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

module.exports = { listar, recientes, opciones, exportar, crear, obtener, borrar };
