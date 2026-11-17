const { json, fail } = require("../../../shared/http/respuesta");
const { readBody } = require("../../../shared/http/body");
const { isObj } = require("../../../shared/utils/validacion");
const service = require("../services/voz.service");

async function token(req, res) {
  // El cuerpo es opcional: {descartar, motivo} cuando la key anterior falló en el navegador.
  let pedido = {};
  try { const raw = await readBody(req, 4096); pedido = raw ? JSON.parse(raw) : {}; } catch (_) {}
  const r = await service.token(isObj(pedido) ? pedido : {});
  return r.error ? fail(res, r.status, r.error) : json(res, 200, r);
}

// El navegador habla directo con Google: el servidor no ve los tokens. Los manda al terminar la llamada.
async function uso(req, res, { yo }) {
  let datos = {};
  try { const raw = await readBody(req, 4096); datos = raw ? JSON.parse(raw) : {}; } catch (_) {}
  service.registrarUso(isObj(datos) ? datos : {}, yo);
  return json(res, 200, { ok: true });
}

module.exports = { token, uso };
