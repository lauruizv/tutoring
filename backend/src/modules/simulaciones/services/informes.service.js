const crypto = require("crypto");
const { isObj } = require("../../../shared/utils/validacion");
const repo = require("../repositories/informes.repository");
const simulaciones = require("./simulaciones.service");

// Informes de simulaciones: la empresa ve todos; estudiante y junior, solo los suyos.
const loVe = (yo, r) => yo.rol === "empresa" || (Boolean(r.usuarioId) && r.usuarioId === yo.id);

// La fila que muestran las listas (la de Informes y la del inicio de la empresa).
const resumen = r => ({ id: r.id, candidato: r.candidato, escenario: r.escenario && r.escenario.titulo, empresa: r.empresa, fecha: r.fecha, puntaje: r.puntaje });
const masNuevoPrimero = (a, b) => String(b.fecha).localeCompare(String(a.fecha));

function listar(yo) {
  return repo.listar().map(r =>
    isObj(r) && r.id && loVe(yo, r) ? resumen(r) : null
  ).filter(Boolean).sort(masNuevoPrimero);
}

// Los últimos `limite` informes de una empresa (los guardados con su empresaId: cuentas de Postgres).
// Ignora lo ilegible y lo que no tiene empresaId o es de otra empresa.
function recientes(empresaId, limite) {
  if (!empresaId) return [];
  return repo.listar().filter(r => isObj(r) && r.id && r.empresaId === empresaId)
    .map(resumen).sort(masNuevoPrimero).slice(0, limite);
}

// Devuelve { error: { status, message } } o { id }.
// Una cuenta de Postgres (yo.empresaId) deja registrada la simulación, con su precio, ANTES de guardar el informe:
// si no se puede registrar no se guarda nada, y si después no se puede guardar el informe, se anula el registro.
async function crear(r, yo) {
  // El nombre sale de la sesión, no de lo que manda el navegador. Los scripts locales lo traen en el pedido.
  if (!yo.local) { r.candidato = yo.nombre; r.usuarioId = yo.id; }
  if (typeof r.candidato !== "string" || !r.candidato.trim()) return { error: { status: 400, message: "El informe no tiene candidato." } };
  if (!isObj(r.evaluacion)) return { error: { status: 400, message: "El informe no trae la evaluación." } };
  // La simulación y la empresa las pone solo el servidor: lo que mande el navegador se descarta.
  delete r.simulacionId;
  delete r.empresaId;
  let simulacionId = null;
  if (yo.empresaId) {
    try { simulacionId = await simulaciones.registrar({ empresaId: yo.empresaId, usuarioId: yo.id, informe: r }); }
    catch (e) {
      console.error("[informes] no se pudo registrar la simulación -", e.message);
      return { error: { status: 503, message: "No se pudo registrar la simulación. Probá guardar de nuevo en un momento." } };
    }
    r.simulacionId = simulacionId;
    r.empresaId = yo.empresaId;
  }
  r.id = crypto.randomUUID();
  if (!r.fecha) r.fecha = new Date().toISOString();
  try { repo.guardar(r); }
  catch (_) {
    if (simulacionId) await simulaciones.anular(simulacionId);
    return { error: { status: 500, message: "No se pudo escribir el informe en data/informes." } };
  }
  return { id: r.id };
}

// Devuelve { informe } o { error: { status, message } }.
function obtener(id, yo, sinPermiso) {
  const r = repo.leer(id);
  if (!isObj(r)) return { error: { status: 404, message: "El informe no existe" } };
  return loVe(yo, r) ? { informe: r } : { error: { status: 403, message: sinPermiso } };
}

const borrar = id => repo.borrar(id);

module.exports = { listar, recientes, crear, obtener, borrar };
