const voz = require("./controllers/voz.controller");
const informes = require("./controllers/informes.controller");
const audios = require("./controllers/audios.controller");

// El orden importa: "opciones" y "exportar" van antes de /api/informes/:id, porque si no se tomarían
// como el id de un informe. Por eso llevan method "*": con cualquier método, la ruta es suya.
module.exports = [
  { method: "POST", path: "/api/voz/token", handler: voz.token },
  { method: "POST", path: "/api/voz/uso", handler: voz.uso },
  { method: "GET", path: "/api/informes", handler: informes.listar },
  { method: "POST", path: "/api/informes", handler: informes.crear },
  { method: "*", path: "/api/informes/opciones", handler: informes.opciones },
  { method: "*", path: "/api/informes/exportar", handler: informes.exportar },
  { method: "*", path: /^\/api\/informes\/([^/]+)$/, handler: informes.porId },
  { method: "*", path: /^\/api\/informes\/([^/]+)\/audio$/, handler: audios.porInforme }
];
