// Almacén de los audios de las simulaciones: un archivo por informe, con el mismo id.
// Es la única pieza que sabe dónde y cómo se guardan (hoy, una carpeta). El servicio decide quién puede
// subir o escuchar un audio; acá solo se guarda, se abre y se borra. Las funciones son asíncronas para que
// el día que los audios vayan a otro lado (un almacenamiento de archivos, por ejemplo) no cambie quien las usa.
"use strict";

const fs = require("fs/promises");
const path = require("path");

// Formatos que graba un navegador. Se reconocen por los primeros bytes del archivo, no por lo que
// diga quien lo sube: así no se puede guardar otra cosa con nombre de audio.
const FORMATOS = [
  { mime: "audio/webm", extension: "webm", es: b => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: "audio/mp4", extension: "m4a", es: b => b.length > 8 && b.toString("latin1", 4, 8) === "ftyp" },
  { mime: "audio/ogg", extension: "ogg", es: b => b.length > 4 && b.toString("latin1", 0, 4) === "OggS" }
];
const formatoDe = contenido => (Buffer.isBuffer(contenido) && FORMATOS.find(f => f.es(contenido))) || null;

// El id se usa para armar el nombre del archivo: solo letras, números y guiones.
const ID_VALIDO = /^[a-z0-9][a-z0-9-]{5,63}$/i;
function exigirId(id) {
  if (typeof id !== "string" || !ID_VALIDO.test(id)) throw new Error("Identificador de audio inválido");
}

function crearAlmacenDeAudios(carpeta) {
  const ruta = (id, extension) => path.join(carpeta, `${id}.${extension}`);

  // El archivo de un informe, con cualquiera de las extensiones conocidas, o null.
  async function buscar(id) {
    for (const formato of FORMATOS) {
      try { return { formato, contenido: await fs.readFile(ruta(id, formato.extension)) }; }
      catch (e) { if (e.code !== "ENOENT") throw e; }
    }
    return null;
  }

  return {
    // Guarda el audio de un informe. Devuelve { mime, bytes }, o null si el contenido no es un audio conocido.
    async guardar(id, contenido) {
      exigirId(id);
      const formato = formatoDe(contenido);
      if (!formato) return null;
      await fs.mkdir(carpeta, { recursive: true });
      // Primero a un archivo temporal: si se corta a la mitad, no queda un audio roto con el nombre definitivo.
      const temporal = ruta(id, formato.extension) + "." + process.pid + ".tmp";
      await fs.writeFile(temporal, contenido);
      await fs.rename(temporal, ruta(id, formato.extension));
      return { mime: formato.mime, bytes: contenido.length };
    },

    // Devuelve { contenido (Buffer), mime, bytes } o null si ese informe no tiene audio guardado.
    async abrir(id) {
      exigirId(id);
      const hallado = await buscar(id);
      return hallado ? { contenido: hallado.contenido, mime: hallado.formato.mime, bytes: hallado.contenido.length } : null;
    },

    // Borra el audio de un informe. Devuelve true si había algo para borrar.
    async borrar(id) {
      exigirId(id);
      let habia = false;
      for (const formato of FORMATOS) {
        try { await fs.unlink(ruta(id, formato.extension)); habia = true; }
        catch (e) { if (e.code !== "ENOENT") throw e; }
      }
      return habia;
    },

    // Los ids de todos los audios guardados (para encontrar los que quedaron sin informe).
    async ids() {
      let archivos;
      try { archivos = await fs.readdir(carpeta); } catch (_) { return []; }
      const extensiones = new Set(FORMATOS.map(f => f.extension));
      const ids = archivos.map(a => { const punto = a.lastIndexOf("."); return extensiones.has(a.slice(punto + 1)) ? a.slice(0, punto) : ""; });
      return [...new Set(ids.filter(id => ID_VALIDO.test(id)))];
    }
  };
}

module.exports = { crearAlmacenDeAudios, formatoDe };
