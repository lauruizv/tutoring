const { json, fail } = require("../../shared/http/respuesta");
const { exigir } = require("../../shared/http/permisos");

// Inicio de la empresa: los números de su actividad. La lógica está en inicio.service.js.
function crearControlador(inicio) {
  async function obtener(req, res, { url, yo }) {
    if (!exigir(res, yo, ["empresa"])) return;
    const r = await inicio.obtener(yo, url.searchParams.get("dias"));
    if (r.error) return fail(res, r.error.status, r.error.message, r.error.type);
    return json(res, 200, r.datos);
  }
  return { obtener };
}

module.exports = { crearControlador };
