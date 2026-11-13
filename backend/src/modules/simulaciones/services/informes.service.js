// Reglas de los informes de simulaciones: quién ve cuáles y qué tiene que traer uno para guardarse.
// No sabe de HTTP (eso es del controlador) ni de archivos (eso es del repositorio).
const crypto = require("crypto");
const { isObj } = require("../../../shared/utils/validacion");
const repo = require("../repositories/informes.repository");

// La empresa ve todos los informes; estudiante y junior, solo los suyos.
// `loVe` decide sobre un informe; `alcanceDe` dice lo mismo para una lista (ver el repositorio).
const loVe = (yo, r) => yo.rol === "empresa" || (Boolean(r.usuarioId) && r.usuarioId === yo.id);
const alcanceDe = yo => (yo.rol === "empresa" ? { todos: true } : { usuarioId: yo.id });

// Resúmenes de los informes que `yo` puede ver y que pasan el filtro (ver informes/filtro.js).
const listar = (yo, filtro) => repo.listarResumenes(filtro, alcanceDe(yo));

// Candidatos y simulaciones que existen, para los desplegables de los filtros.
const opciones = (yo, filtro) => repo.listarOpciones(alcanceDe(yo), filtro);

// Devuelve { error: { status, message } } o { id }.
async function crear(r, yo) {
  // El nombre sale de la sesión, no de lo que manda el navegador. Los scripts locales lo traen en el pedido.
  if (!yo.local) { r.candidato = yo.nombre; r.usuarioId = yo.id; }
  if (typeof r.candidato !== "string" || !r.candidato.trim()) return { error: { status: 400, message: "El informe no tiene candidato." } };
  if (!isObj(r.evaluacion)) return { error: { status: 400, message: "El informe no trae la evaluación." } };
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

const borrar = id => repo.borrar(id);

module.exports = { listar, opciones, crear, obtener, borrar };
