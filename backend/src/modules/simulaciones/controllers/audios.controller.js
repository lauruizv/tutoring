// Audio de la simulación de un informe: lee el pedido, llama al servicio y arma la respuesta.
const { json, fail } = require("../../../shared/http/respuesta");
const { readBuffer } = require("../../../shared/http/body");
const { MSG_SIN_PERMISO } = require("../../../shared/http/permisos");
const { safeId } = require("../../../shared/utils/validacion");
const { LIMITS } = require("../../../config/limits");
const service = require("../services/audios.service");

const responderError = (res, e) => fail(res, e.status, e.message);

// GET /api/informes/:id/audio
async function escuchar(res, id, yo) {
  const out = await service.obtener(id, yo, MSG_SIN_PERMISO);
  if (out.error) return responderError(res, out.error);
  res.writeHead(200, { "content-type": out.audio.mime, "content-length": out.audio.bytes, "cache-control": "private, no-store" });
  return res.end(out.audio.contenido);
}

// PUT /api/informes/:id/audio?duracion=<segundos>  (el cuerpo es el archivo de audio)
async function subir(req, res, id, yo, url) {
  // Primero se mira si puede subirlo: no tiene sentido recibir 10 MB para después decir que no.
  const permiso = await service.permisoParaSubir(id, yo, MSG_SIN_PERMISO);
  if (permiso.error) return responderError(res, permiso.error);
  let contenido;
  try { contenido = await readBuffer(req, LIMITS.audio); }
  catch (e) {
    if (e.code === "too_large") fail(res, 413, `El audio es demasiado grande (máximo ${Math.round(LIMITS.audio / 1e6)} MB).`);
    return;
  }
  const out = await service.guardar(permiso.informe, contenido, url.searchParams.get("duracion"));
  return out.error ? responderError(res, out.error) : json(res, 200, { ok: true, audio: out.audio });
}

// /api/informes/:id/audio: el id se valida antes que el método.
async function porInforme(req, res, { yo, url, params }) {
  const id = params[0];
  if (!safeId(id)) return fail(res, 400, "Identificador de informe inválido");
  if (req.method === "GET") return escuchar(res, id, yo);
  if (req.method === "PUT") return subir(req, res, id, yo, url);
  return fail(res, 405, "Método no permitido");
}

module.exports = { porInforme };
