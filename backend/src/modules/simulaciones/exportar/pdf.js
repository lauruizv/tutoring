// Exportador a PDF. Recibe filas de exportación (lib/informes/dto.js) y devuelve el archivo.
// No sabe de dónde salen los datos ni quién lo pide.
"use strict";

const path = require("path");
const { COLUMNAS } = require("../informes/dto");
const { diaHora, duracion } = require("./formato");

const SIN_DATO = "—";
// Texto de la celda, ancho de la columna y alineación según el tipo de columna.
const TEXTO = {
  texto: v => v || SIN_DATO,
  fecha: (v, meta) => (v ? diaHora(v, meta.zona) : SIN_DATO),
  numero: v => (v == null ? SIN_DATO : String(v)),
  duracion: v => (v == null ? SIN_DATO : duracion(v))
};
// Los textos se reparten el ancho que sobra ("*") y pueden ocupar más de una línea.
// Fecha, nota y duración tienen ancho fijo (en puntos) y van en una sola línea: con ancho automático se partían.
const ANCHO = { texto: "*", fecha: 82, numero: 66, duracion: 44 };
const ALINEADO = { texto: "left", fecha: "left", numero: "right", duracion: "right" };
const EN_UNA_LINEA = { texto: false, fecha: true, numero: true, duracion: true };

// Qué dice el documento y cómo se ordena, sin generar nada: por eso se puede probar sin armar el PDF.
// Todo lo que viene de los informes va como texto plano (pdfmake no interpreta formato dentro de un texto).
function definicionPdf(filas, meta) {
  const cuantos = filas.length === 1 ? "1 informe" : `${filas.length} informes`;
  const filtros = meta.filtros.length ? meta.filtros.map(([nombre, valor]) => `${nombre}: ${valor}`).join("  ·  ") : "Sin filtros";
  const celda = (c, text, extra) => ({ text, alignment: ALINEADO[c.tipo], noWrap: EN_UNA_LINEA[c.tipo], ...extra });
  const encabezado = COLUMNAS.map(c => celda(c, c.titulo, { style: "encabezado" }));
  const cuerpo = filas.map(fila => COLUMNAS.map(c => celda(c, TEXTO[c.tipo](fila[c.clave], meta))));
  return {
    pageSize: "A4",
    pageMargins: [36, 40, 36, 44],
    info: { title: "Informes de candidatos", author: "Tutoring" },
    content: [
      { text: "Informes de candidatos", style: "titulo" },
      meta.empresa ? { text: meta.empresa, style: "empresa" } : null,
      { text: `${cuantos}  ·  Generado el ${diaHora(meta.generado, meta.zona)}`, style: "dato" },
      { text: filtros, style: "dato", margin: [0, 0, 0, 14] },
      filas.length
        // headerRows repite el encabezado en cada página; dontBreakRows evita que una fila quede partida en dos.
        ? { table: { headerRows: 1, dontBreakRows: true, widths: COLUMNAS.map(c => ANCHO[c.tipo]), body: [encabezado, ...cuerpo] }, layout: "lightHorizontalLines" }
        : { text: "No hay informes con estos filtros.", italics: true }
    ].filter(Boolean),
    footer: (pagina, total) => ({
      margin: [36, 14, 36, 0], fontSize: 8, color: "#8B8896",
      columns: [{ text: "Tutoring  ·  La decisión siempre la toma una persona." }, { text: `Página ${pagina} de ${total}`, alignment: "right" }]
    }),
    styles: {
      titulo: { fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
      empresa: { fontSize: 11, margin: [0, 0, 0, 6] },
      dato: { fontSize: 9, color: "#6B6878", margin: [0, 0, 0, 2] },
      encabezado: { bold: true, color: "#6E52B0" }
    },
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#17161B" }
  };
}

// pdfmake se carga y se configura una sola vez, la primera vez que alguien exporta (es una librería pesada).
let pdfmake = null;
function motor() {
  if (pdfmake) return pdfmake;
  pdfmake = require("pdfmake");
  const tipografias = require("pdfmake/fonts/Roboto");
  // path.resolve en los dos lados de la comparación: pdfmake arma las rutas de sus tipografías con "/" y en Windows
  // quedan con las dos barras mezcladas ("fonts/Roboto" dentro de "C:\\..."). Sin normalizar, no coinciden.
  const carpeta = path.resolve(path.dirname(tipografias.Roboto.normal)) + path.sep;
  pdfmake.addFonts(tipografias);
  // El documento solo lleva texto. No se le permite bajar nada de internet ni leer archivos que no sean sus tipografías.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy(ruta => path.resolve(String(ruta)).startsWith(carpeta));
  return pdfmake;
}

async function generar(filas, meta) {
  return Buffer.from(await motor().createPdf(definicionPdf(filas, meta)).getBuffer());
}

module.exports = { extension: "pdf", tipoMime: "application/pdf", generar, definicionPdf };
