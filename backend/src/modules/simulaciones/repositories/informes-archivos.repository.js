// Repositorio de informes sobre archivos JSON (un archivo por informe).
// Es la única pieza que sabe dónde y cómo están guardados. El servicio le pide las cosas por su nombre
// (un informe por id, una lista con un filtro y un alcance) y no se entera de que hay archivos.
//
// Las funciones son asíncronas aunque acá se lea el disco: así, el día que los informes estén en
// PostgreSQL, se escribe otro repositorio con estas mismas funciones y no cambia quien las usa.
//
// Alcance (qué informes puede ver quien pregunta por una lista):
//   { todos: true }        todos los informes (la empresa)
//   { usuarioId: "..." }   solo los de esa persona (candidato o junior)
// Cualquier otra cosa no ve nada: un alcance mal armado nunca abre la lista por descuido.
"use strict";

const fs = require("fs/promises");
const path = require("path");
const { cumple } = require("../informes/filtro");

// Cuántos archivos se leen a la vez: sin tope, una carpeta grande agota los archivos abiertos del sistema.
const LOTE = 32;

const esObjeto = v => Boolean(v) && typeof v === "object" && !Array.isArray(v);

const enAlcance = (informe, alcance) => {
  if (!esObjeto(alcance)) return false;
  if (alcance.todos === true) return true;
  return Boolean(alcance.usuarioId) && informe.usuarioId === alcance.usuarioId;
};

// Lo que se muestra en las listas: nunca el informe entero.
const aResumen = r => ({
  id: r.id,
  candidato: r.candidato,
  escenario: r.escenario && r.escenario.titulo,
  empresa: r.empresa,
  fecha: r.fecha,
  puntaje: r.puntaje,
  duracionSeg: Number.isFinite(r.duracionSeg) ? r.duracionSeg : null
});

// Del más nuevo al más viejo; con la misma fecha, por id, para que el orden sea siempre el mismo.
const masNuevoPrimero = (a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(a.id).localeCompare(String(b.id));

const sinRepetir = textos => [...new Set(textos.filter(t => typeof t === "string" && t.trim()))].sort((a, b) => a.localeCompare(b, "es"));

function crearRepositorioArchivos(carpeta) {
  const archivoDe = id => path.join(carpeta, id + ".json");

  // El informe de un archivo, o null si no existe, está roto o quedó a medio escribir.
  async function leerArchivo(archivo) {
    try {
      const informe = JSON.parse(await fs.readFile(archivo, "utf8"));
      return esObjeto(informe) && informe.id ? informe : null;
    } catch (_) { return null; }
  }

  // Todos los informes legibles de la carpeta, leídos de a tandas.
  async function todos() {
    let archivos;
    try { archivos = (await fs.readdir(carpeta)).filter(f => f.endsWith(".json")); }
    catch (_) { return []; }
    const lista = [];
    for (let i = 0; i < archivos.length; i += LOTE) {
      const tanda = await Promise.all(archivos.slice(i, i + LOTE).map(f => leerArchivo(path.join(carpeta, f))));
      for (const informe of tanda) if (informe) lista.push(informe);
    }
    return lista;
  }

  async function resumenes(alcance) {
    if (!esObjeto(alcance)) return [];
    return (await todos()).filter(informe => enAlcance(informe, alcance)).map(aResumen);
  }

  return {
    // Un informe entero por su id, o null si no existe.
    leer: id => leerArchivo(archivoDe(id)),

    // Guarda (o reemplaza) un informe. Se escribe en un archivo temporal y se renombra:
    // si el servidor se corta a la mitad, no queda un informe a medio escribir.
    async guardar(informe) {
      const destino = archivoDe(informe.id);
      const temporal = destino + "." + process.pid + ".tmp";
      await fs.writeFile(temporal, JSON.stringify(informe, null, 2));
      await fs.rename(temporal, destino);
    },

    // Que no exista ya cuenta como borrado.
    async borrar(id) {
      try { await fs.unlink(archivoDe(id)); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
    },

    // Todos los informes enteros (lo usa la limpieza de audios). Para las listas, usar listarResumenes.
    listarTodos: todos,

    // Resúmenes que pasan el filtro, del más nuevo al más viejo.
    async listarResumenes(filtro, alcance) {
      return (await resumenes(alcance)).filter(r => cumple(r, filtro)).sort(masNuevoPrimero);
    },

    // Candidatos y simulaciones que existen, para armar los desplegables de los filtros.
    // De `filtro` solo se usa la empresa: si los otros filtros achicaran las opciones,
    // al elegir una simulación desaparecerían las demás de la lista.
    async listarOpciones(alcance, filtro) {
      const empresa = (filtro && filtro.empresa) || "";
      const lista = (await resumenes(alcance)).filter(r => cumple(r, { empresa }));
      return { candidatos: sinRepetir(lista.map(r => r.candidato)), escenarios: sinRepetir(lista.map(r => r.escenario)) };
    }
  };
}

module.exports = { crearRepositorioArchivos };
