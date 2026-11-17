const { crearControlador } = require("./inicio.controller");

// Recibe el servicio ya armado (con sus fuentes de datos) desde routes.js.
module.exports = inicio => [
  { method: "GET", path: "/api/empresa/inicio", handler: crearControlador(inicio).obtener }
];
