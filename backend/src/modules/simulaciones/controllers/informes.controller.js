// Informes de simulaciones: lee el pedido, llama al servicio y arma la respuesta.
const { json, fail } = require("../../../shared/http/respuesta");
const { bodyObject } = require("../../../shared/http/body");
const { exigir, MSG_SIN_PERMISO } = require("../../../shared/http/permisos");
const { safeId } = require("../../../shared/utils/validacion");
const { LIMITS } = require("../../../config/limits");
const { normalizarFiltro } = require("../informes/filtro");
const service = require("../services/informes.service");

// El filtro que viene en la dirección: ?desde=&hasta=&candidato=&escenario=&empresa=
// Devuelve null y ya respondió 400 si alguno no se entiende.
function filtroDelPedido(res, url) {
  try { return normalizarFiltro(url.searchParams); }
  catch (e) {
    if (e.code !== "filtro_invalido") throw e;
    fail(res, 400, e.message);
    return null;
  }
}

// GET /api/informes
async function listar(req, res, { yo, url }) {
  const filtro = filtroDelPedido(res, url);
  if (!filtro) return;
  return json(res, 200, await service.listar(yo, filtro));
}

// GET /api/informes/opciones
async function opciones(req, res, { yo, url }) {
  if (req.method !== "GET") return fail(res, 405, "Método no permitido");
  const filtro = filtroDelPedido(res, url);
  if (!filtro) return;
  return json(res, 200, await service.opciones(yo, filtro));
}

// GET /api/informes/exportar?formato=xlsx|pdf&zona=<zona horaria>, más los filtros de la lista. Solo la empresa.
async function exportar(req, res, { yo, url }) {
  if (req.method !== "GET") return fail(res, 405, "Método no permitido");
  if (!exigir(res, yo, ["empresa"])) return;
  const filtro = filtroDelPedido(res, url);
  if (!filtro) return;
  let archivo;
  try {
    archivo = await service.exportar(yo, filtro, { formato: url.searchParams.get("formato"), zona: url.searchParams.get("zona") });
  } catch (e) {
    if (e.code === "exportacion_invalida") return fail(res, 400, e.message);
    // exceljs y pdfmake se cargan recién al exportar: si no están instaladas, se dice cómo arreglarlo.
    if (e.code === "MODULE_NOT_FOUND") return fail(res, 500, "Para exportar hace falta instalar las dependencias: corré npm install en la carpeta del proyecto y reiniciá el servidor.");
    throw e;
  }
  res.writeHead(200, {
    "content-type": archivo.tipoMime,
    "content-length": archivo.contenido.length,
    "content-disposition": `attachment; filename="${archivo.nombre}"`,
    "x-informes": String(archivo.cantidad),   // cuántos informes lleva el archivo, para avisarle a quien exporta
    "cache-control": "no-store"
  });
  return res.end(archivo.contenido);
}

// POST /api/informes
async function crear(req, res, { yo }) {
  const r = await bodyObject(req, res, LIMITS.informe, "");
  if (!r) return;
  const out = await service.crear(r, yo);
  return out.error ? fail(res, out.error.status, out.error.message) : json(res, 200, { id: out.id });
}

// /api/informes/:id: el id se valida antes que el método.
async function porId(req, res, { yo, params }) {
  const id = params[0];
  if (!safeId(id)) return fail(res, 400, "Identificador de informe inválido");
  if (req.method === "GET") {
    const out = await service.obtener(id, yo, MSG_SIN_PERMISO);
    return out.error ? fail(res, out.error.status, out.error.message) : json(res, 200, out.informe);
  }
  if (req.method === "DELETE") {
    if (!exigir(res, yo, ["empresa"])) return;
    try { await service.borrar(id); } catch (_) { return fail(res, 500, "No se pudo eliminar el informe"); }
    return json(res, 200, { ok: true });
  }
  return fail(res, 405, "Método no permitido");
}

module.exports = { listar, opciones, exportar, crear, porId, filtroDelPedido };
