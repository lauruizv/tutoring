// Fila de exportación: lo que sale en el Excel y en el PDF por cada informe.
// Es el único lugar que sabe qué columnas se exportan y de qué campo del resumen sale cada una.
// Los exportadores (lib/exportar/) reciben estas filas y no saben de dónde vienen los datos.
"use strict";

// tipo: "texto" | "mail" | "codigo" (un identificador: no se parte en dos líneas) | "fecha" (Date) | "numero" | "duracion" (segundos).
// Cada exportador decide cómo mostrar cada tipo.
const COLUMNAS = [
  { clave: "simulacion", titulo: "Simulación", tipo: "texto" },
  { clave: "candidato", titulo: "Candidato", tipo: "texto" },
  { clave: "email", titulo: "Mail", tipo: "mail" },
  { clave: "usuarioId", titulo: "IdUsuario", tipo: "codigo" },
  { clave: "fecha", titulo: "Fecha", tipo: "fecha" },
  { clave: "puntaje", titulo: "Nota (0 a 100)", tipo: "numero" },
  { clave: "duracionSeg", titulo: "Duración", tipo: "duracion" }
];

const texto = v => (typeof v === "string" ? v.trim() : "");
const numero = v => (Number.isFinite(v) ? v : null);

// Del resumen de un informe (lo que devuelve el repositorio) a una fila de exportación.
// Lo que falta o no se entiende queda en "" (textos) o null (fecha y números): nunca se inventa un valor.
function aFilaExport(resumen) {
  const instante = Date.parse(resumen.fecha);
  return {
    simulacion: texto(resumen.escenario),
    candidato: texto(resumen.candidato),
    email: texto(resumen.email),
    usuarioId: texto(resumen.usuarioId),
    fecha: Number.isNaN(instante) ? null : new Date(instante),
    puntaje: numero(resumen.puntaje),
    duracionSeg: numero(resumen.duracionSeg)
  };
}

module.exports = { COLUMNAS, aFilaExport };
