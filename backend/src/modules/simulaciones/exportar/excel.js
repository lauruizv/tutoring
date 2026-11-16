// Exportador a Excel (.xlsx). Recibe filas de exportación (lib/informes/dto.js) y devuelve el archivo.
// No sabe de dónde salen los datos ni quién lo pide.
"use strict";

const { COLUMNAS } = require("../informes/dto");
const { relojDe, diaHora } = require("./formato");

const SEGUNDOS_POR_DIA = 86400;
const ANCHO = { texto: 36, mail: 36, codigo: 40, fecha: 18, numero: 15, duracion: 12 };
// Formato de celda de Excel por tipo de columna. "[m]:ss" muestra los minutos totales (75:10, no 1:15:10).
const FORMATO = { fecha: "dd/mm/yyyy hh:mm", duracion: "[m]:ss" };

// Excel no tiene zonas horarias: una fecha es la hora de reloj, y exceljs la arma con los campos UTC del Date.
// Por eso se le pasa un Date cuyos campos UTC son la hora de reloj de quien exporta.
function horaDeReloj(fecha, zona) {
  const r = relojDe(fecha, zona);
  return new Date(Date.UTC(r.anio, r.mes - 1, r.dia, r.hora, r.minuto, r.segundo));
}

// Valor de la celda según el tipo de columna. Se guardan datos, no textos: la fecha es una fecha, la nota un número
// y la duración un tiempo, así en Excel se pueden ordenar, filtrar y promediar. Lo que falta queda vacío.
// Los textos van como texto: un nombre que empieza con "=" no se convierte en fórmula.
const CELDA = {
  texto: v => v || null,
  mail: v => v || null,
  codigo: v => v || null,
  fecha: (v, meta) => (v ? horaDeReloj(v, meta.zona) : null),
  numero: v => v,
  duracion: v => (v == null ? null : v / SEGUNDOS_POR_DIA)
};

async function generar(filas, meta) {
  const ExcelJS = require("exceljs");   // es una librería pesada: se carga recién cuando alguien exporta
  const libro = new ExcelJS.Workbook();
  libro.creator = "Tutoring";
  libro.created = meta.generado;

  const hoja = libro.addWorksheet("Informes", { views: [{ state: "frozen", ySplit: 1 }] });   // el encabezado queda fijo
  hoja.columns = COLUMNAS.map(c => ({ header: c.titulo, key: c.clave, width: ANCHO[c.tipo], style: FORMATO[c.tipo] ? { numFmt: FORMATO[c.tipo] } : {} }));
  for (const fila of filas) hoja.addRow(COLUMNAS.map(c => CELDA[c.tipo](fila[c.clave], meta)));
  hoja.getRow(1).eachCell(celda => {
    celda.font = { bold: true };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1ECFB" } };
  });
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS.length } };

  // Segunda hoja: de dónde salió el archivo, para quien lo recibe sin haber visto la pantalla.
  const datos = libro.addWorksheet("Exportación");
  datos.columns = [{ width: 18 }, { width: 48 }];
  datos.addRows([
    ["Empresa", meta.empresa || "—"],
    ["Generado", diaHora(meta.generado, meta.zona)],
    ["Zona horaria", meta.zona],
    ["Informes", filas.length],
    ...(meta.filtros.length ? meta.filtros : [["Filtros", "ninguno"]])
  ]);
  datos.getColumn(1).font = { bold: true };
  datos.getColumn(2).alignment = { horizontal: "left" };

  return Buffer.from(await libro.xlsx.writeBuffer());
}

module.exports = { extension: "xlsx", tipoMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", generar };
