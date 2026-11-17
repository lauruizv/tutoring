// El almacén de audios que usa la app: hoy, archivos en data/audios.
// Para llevarlos a otro lado (S3, por ejemplo) se cambia esta línea por otro almacén con las mismas
// funciones (guardar, abrir, borrar, ids); el servicio no se toca.
const { AUDIOS } = require("../../../config/paths");
const { crearAlmacenDeAudios } = require("./audios-archivos.repository");

module.exports = crearAlmacenDeAudios(AUDIOS);
