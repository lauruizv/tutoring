// El repositorio de informes que usa la app: hoy, archivos JSON en data/informes.
// Para pasar a PostgreSQL se cambia esta línea por otro repositorio con las mismas funciones
// (leer, guardar, borrar, listarTodos, listarResumenes, listarOpciones); el servicio no se toca.
const { REPORTS } = require("../../../config/paths");
const { crearRepositorioArchivos } = require("./informes-archivos.repository");

module.exports = crearRepositorioArchivos(REPORTS);
