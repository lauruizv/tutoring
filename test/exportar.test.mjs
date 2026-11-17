/* Pruebas de la exportación de informes a Excel y PDF.
   No levantan el servidor: los exportadores reciben filas y devuelven un archivo. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const { COLUMNAS, aFilaExport } = require("../backend/src/modules/simulaciones/informes/dto.js");
const formato = require("../backend/src/modules/simulaciones/exportar/formato.js");
const excel = require("../backend/src/modules/simulaciones/exportar/excel.js");
const pdf = require("../backend/src/modules/simulaciones/exportar/pdf.js");
const { exportarInformes, FORMATOS, MAX_FILAS } = require("../backend/src/modules/simulaciones/exportar/index.js");
const { normalizarFiltro } = require("../backend/src/modules/simulaciones/informes/filtro.js");

const BSAS = "America/Argentina/Buenos_Aires";   // UTC-3 todo el año
const resumen = extra => ({ id: "x", candidato: "Lucía Pérez", escenario: "Llamada de cobranza", empresa: "MKT Contact Center", fecha: "2026-11-10T15:05:00.000Z", puntaje: 84, duracionSeg: 245, usuarioId: "7b1e2c7e-4c1d-4f0a-9a55-0d2f6f0c9a11", email: "lucia@ejemplo.test", ...extra });
const meta = extra => ({ empresa: "MKT Contact Center", generado: new Date("2026-11-11T13:30:00.000Z"), zona: BSAS, filtros: [], ...extra });
const filtro = obj => normalizarFiltro(new URLSearchParams(obj));
// Cuenta las páginas de un PDF: pdfkit escribe un objeto "/Type /Page" por cada una.
const paginas = buffer => (buffer.toString("latin1").match(/\/Type \/Page\b(?!s)/g) || []).length;
// Al releer, exceljs devuelve una celda de tiempo como Date contado desde el día cero de Excel (30/12/1899).
const DIA_CERO_DE_EXCEL = Date.UTC(1899, 11, 30);
const segundosDe = celda => Math.round((celda.value.getTime() - DIA_CERO_DE_EXCEL) / 1000);
async function leerExcel(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  return libro;
}

describe("fila de exportación (DTO)", () => {
  test("las columnas son las pedidas, en orden", () => {
    assert.deepEqual(COLUMNAS.map(c => c.titulo), ["Simulación", "Candidato", "Mail", "IdUsuario", "Fecha", "Nota (0 a 100)", "Duración"]);
  });

  test("pasa el resumen de un informe a una fila", () => {
    assert.deepEqual(aFilaExport(resumen()), { simulacion: "Llamada de cobranza", candidato: "Lucía Pérez", email: "lucia@ejemplo.test", usuarioId: "7b1e2c7e-4c1d-4f0a-9a55-0d2f6f0c9a11", fecha: new Date("2026-11-10T15:05:00.000Z"), puntaje: 84, duracionSeg: 245 });
  });

  test("lo que falta o no se entiende queda vacío: nunca se inventa un valor", () => {
    const fila = aFilaExport(resumen({ candidato: undefined, escenario: null, fecha: "sin fecha", puntaje: null, duracionSeg: "mucho", usuarioId: null, email: undefined }));
    assert.deepEqual(fila, { simulacion: "", candidato: "", email: "", usuarioId: "", fecha: null, puntaje: null, duracionSeg: null });
    assert.equal(aFilaExport(resumen({ puntaje: 0, duracionSeg: 0 })).puntaje, 0, "un cero es un dato, no un faltante");
  });

  test("la fila no lleva nada más que las columnas (ni el id ni la empresa)", () => {
    assert.deepEqual(Object.keys(aFilaExport(resumen())), COLUMNAS.map(c => c.clave));
  });
});

describe("formatos compartidos", () => {
  const instante = new Date("2026-11-10T02:05:09.000Z");   // en Buenos Aires todavía es el 9 a las 23:05

  test("las fechas salen en la hora de la zona pedida", () => {
    assert.deepEqual(formato.relojDe(instante, BSAS), { anio: 2026, mes: 11, dia: 9, hora: 23, minuto: 5, segundo: 9 });
    assert.equal(formato.diaHora(instante, BSAS), "09/11/2026 23:05");
    assert.equal(formato.dia(instante, BSAS), "09/11/2026");
    assert.equal(formato.diaIso(instante, BSAS), "2026-11-09");
    assert.equal(formato.diaHora(instante, "UTC"), "10/11/2026 02:05");
    assert.equal(formato.relojDe(new Date("2026-11-10T03:00:00.000Z"), BSAS).hora, 0, "la medianoche es la hora 0, no la 24");
  });

  test("una zona que falta o no existe se cambia por la de por defecto", () => {
    for (const zona of [undefined, null, "", "Marte/Olympus", 42, "x".repeat(200)]) assert.equal(formato.zonaValida(zona), BSAS, String(zona));
    assert.equal(formato.zonaValida("Europe/Madrid"), "Europe/Madrid");
  });

  test("la duración se escribe en minutos y segundos", () => {
    assert.equal(formato.duracion(245), "4:05");
    assert.equal(formato.duracion(0), "0:00");
    assert.equal(formato.duracion(4510), "75:10", "más de una hora sigue en minutos");
  });

  test("describe los filtros puestos; 'hasta' muestra el último día que entra", () => {
    // Del 1 al 10 de noviembre en Buenos Aires: el navegador manda el comienzo del 1 y el comienzo del 11.
    const f = filtro({ desde: "2026-11-01T03:00:00.000Z", hasta: "2026-11-11T03:00:00.000Z", candidato: "ana", escenario: "Llamada de cobranza", empresa: "MKT" });
    assert.deepEqual(formato.describirFiltro(f, BSAS), [["Desde", "01/11/2026"], ["Hasta", "10/11/2026"], ["Simulación", "Llamada de cobranza"], ["Candidato", "contiene “ana”"]]);
    assert.deepEqual(formato.describirFiltro(filtro({ empresa: "MKT" }), BSAS), [], "la empresa no es un filtro que elija la persona");
  });
});

describe("Excel", () => {
  const filas = [
    aFilaExport(resumen()),
    aFilaExport(resumen({ candidato: '=HYPERLINK("http://malo","clic")', escenario: "+54 11 5555", puntaje: null, duracionSeg: null, fecha: "sin fecha" })),
    aFilaExport(resumen({ candidato: "Ñandú Ibáñez", puntaje: 0, duracionSeg: 4510, fecha: "2026-11-10T02:05:00.000Z" }))
  ];

  test("dice que es un .xlsx", () => {
    assert.equal(excel.extension, "xlsx");
    assert.match(excel.tipoMime, /spreadsheetml\.sheet$/);
  });

  test("la hoja Informes tiene el encabezado y una fila por informe, con datos y no textos", async () => {
    const hoja = (await leerExcel(await excel.generar(filas, meta()))).getWorksheet("Informes");
    assert.deepEqual(hoja.getRow(1).values.slice(1), ["Simulación", "Candidato", "Mail", "IdUsuario", "Fecha", "Nota (0 a 100)", "Duración"]);
    assert.equal(hoja.rowCount, 4);

    const [simulacion, candidato, mail, idUsuario, fecha, nota] = hoja.getRow(2).values.slice(1);
    assert.deepEqual([mail, idUsuario], ["lucia@ejemplo.test", "7b1e2c7e-4c1d-4f0a-9a55-0d2f6f0c9a11"]);
    assert.equal(hoja.getCell("D2").type, ExcelJS.ValueType.String, "el id es un texto");
    assert.equal(simulacion, "Llamada de cobranza");
    assert.equal(candidato, "Lucía Pérez");
    assert.equal(nota, 84);
    assert.equal(hoja.getCell("F2").type, ExcelJS.ValueType.Number);
    // La fecha es una fecha de Excel con la hora de reloj de Buenos Aires: 15:05 UTC son las 12:05.
    assert.equal(hoja.getCell("E2").type, ExcelJS.ValueType.Date);
    assert.equal(fecha.toISOString(), "2026-11-10T12:05:00.000Z");
    assert.equal(hoja.getCell("E2").numFmt, "dd/mm/yyyy hh:mm");
    // La duración es un tiempo que Excel muestra como minutos:segundos (4:05), no un texto.
    assert.equal(hoja.getCell("G2").numFmt, "[m]:ss");
    assert.equal(segundosDe(hoja.getCell("G2")), 245);
    assert.equal(segundosDe(hoja.getCell("G4")), 4510, "más de una hora");
  });

  test("lo que falta queda en blanco y el cero se escribe", async () => {
    const hoja = (await leerExcel(await excel.generar(filas, meta()))).getWorksheet("Informes");
    for (const celda of ["E3", "F3", "G3"]) assert.equal(hoja.getCell(celda).value, null, celda);
    assert.equal(hoja.getCell("F4").value, 0);
  });

  test("un nombre que empieza con = o + queda como texto, no como fórmula", async () => {
    const hoja = (await leerExcel(await excel.generar(filas, meta()))).getWorksheet("Informes");
    assert.equal(hoja.getCell("B3").type, ExcelJS.ValueType.String);
    assert.equal(hoja.getCell("B3").value, '=HYPERLINK("http://malo","clic")');
    assert.equal(hoja.getCell("B3").formula, undefined);
    assert.equal(hoja.getCell("A3").type, ExcelJS.ValueType.String);
  });

  test("el encabezado queda fijo y con el filtro de Excel", async () => {
    const hoja = (await leerExcel(await excel.generar(filas, meta()))).getWorksheet("Informes");
    assert.equal(hoja.views[0].state, "frozen");
    assert.equal(hoja.views[0].ySplit, 1);
    assert.ok(hoja.autoFilter, "tiene filtro automático");
    assert.equal(hoja.getCell("A1").font.bold, true);
  });

  test("la hoja Exportación dice de dónde salió el archivo y con qué filtros", async () => {
    const con = (await leerExcel(await excel.generar(filas, meta({ filtros: [["Desde", "01/11/2026"], ["Candidato", "contiene “ana”"]] })))).getWorksheet("Exportación");
    const pares = Object.fromEntries(con.getSheetValues().filter(Boolean).map(f => [f[1], f[2]]));
    assert.deepEqual(pares, { Empresa: "MKT Contact Center", Generado: "11/11/2026 10:30", "Zona horaria": BSAS, Informes: 3, Desde: "01/11/2026", Candidato: "contiene “ana”" });

    const sin = (await leerExcel(await excel.generar([], meta({ empresa: "" })))).getWorksheet("Exportación");
    const paresSin = Object.fromEntries(sin.getSheetValues().filter(Boolean).map(f => [f[1], f[2]]));
    assert.equal(paresSin.Filtros, "ninguno");
    assert.equal(paresSin.Empresa, "—");
    assert.equal(paresSin.Informes, 0);
  });

  test("sin informes sale el archivo igual, con el encabezado solo", async () => {
    const hoja = (await leerExcel(await excel.generar([], meta()))).getWorksheet("Informes");
    assert.equal(hoja.rowCount, 1);
  });
});

describe("PDF", () => {
  const filas = [aFilaExport(resumen()), aFilaExport(resumen({ candidato: "", puntaje: null, duracionSeg: null, fecha: "sin fecha", usuarioId: null, email: "" }))];
  const tabla = def => def.content.find(x => x.table).table;
  const textos = def => def.content.map(x => x.text).filter(Boolean);

  test("dice que es un .pdf", () => {
    assert.equal(pdf.extension, "pdf");
    assert.equal(pdf.tipoMime, "application/pdf");
  });

  test("la definición lleva el encabezado repetido en cada página y una fila por informe", () => {
    const t = tabla(pdf.definicionPdf(filas, meta()));
    assert.equal(t.headerRows, 1);
    assert.equal(t.widths.length, 7);
    assert.equal(pdf.definicionPdf(filas, meta()).pageOrientation, "landscape", "con siete columnas va apaisado");
    assert.deepEqual(t.body[1].map(c => c.noWrap), [false, false, false, true, true, true, true], "el id, la fecha, la nota y la duración no se parten en dos líneas");
    assert.ok(t.widths.slice(2).every(a => typeof a === "number"), "solo simulación y candidato se reparten el ancho que sobra");
    assert.deepEqual(t.body[0].map(c => c.text), ["Simulación", "Candidato", "Mail", "IdUsuario", "Fecha", "Nota (0 a 100)", "Duración"]);
    assert.deepEqual(t.body[1].map(c => c.text), ["Llamada de cobranza", "Lucía Pérez", "lucia@ejemplo.test", "7b1e2c7e-4c1d-4f0a-9a55-0d2f6f0c9a11", "10/11/2026 12:05", "84", "4:05"], "la fecha, en la hora de Buenos Aires");
    assert.deepEqual(t.body[2].map(c => c.text), ["Llamada de cobranza", "—", "—", "—", "—", "—", "—"], "lo que falta se marca con una raya");
    assert.equal(t.body.length, 3);
  });

  test("un mail largo va en dos líneas, cortado antes de la arroba: si no, ensancha la tabla y se sale de la hoja", () => {
    const mailDe = email => tabla(pdf.definicionPdf([aFilaExport(resumen({ email }))], meta())).body[1][2].text;
    assert.equal(mailDe("ana@empresa.com"), "ana@empresa.com");
    assert.equal(mailDe("maria.fernanda.gonzalez.echeverria@mktcontactcenter.com.ar"), "maria.fernanda.gonzalez.echeverria\n@mktcontactcenter.com.ar");
  });

  test("arriba dice la empresa, cuántos informes son, cuándo se generó y los filtros", () => {
    const con = textos(pdf.definicionPdf(filas, meta({ filtros: [["Desde", "01/11/2026"], ["Candidato", "contiene “ana”"]] })));
    assert.deepEqual(con, ["Informes de candidatos", "MKT Contact Center", "2 informes  ·  Generado el 11/11/2026 10:30", "Desde: 01/11/2026  ·  Candidato: contiene “ana”"]);
    const sin = textos(pdf.definicionPdf([filas[0]], meta({ empresa: "" })));
    assert.deepEqual(sin, ["Informes de candidatos", "1 informe  ·  Generado el 11/11/2026 10:30", "Sin filtros"]);
  });

  test("sin informes no hay tabla: lo dice con un mensaje", () => {
    const def = pdf.definicionPdf([], meta());
    assert.equal(def.content.some(x => x.table), false);
    assert.ok(textos(def).includes("No hay informes con estos filtros."));
  });

  test("el pie numera las páginas", () => {
    const pie = pdf.definicionPdf(filas, meta()).footer(2, 7);
    assert.equal(pie.columns[1].text, "Página 2 de 7");
  });

  test("genera un PDF de verdad, de una página con pocos informes y de varias con muchos", async () => {
    const corto = await pdf.generar(filas, meta());
    assert.ok(Buffer.isBuffer(corto));
    assert.equal(corto.subarray(0, 5).toString(), "%PDF-");
    assert.equal(paginas(corto), 1);

    const muchas = Array.from({ length: 200 }, (_, i) => aFilaExport(resumen({ candidato: "Candidato " + i })));
    const largo = await pdf.generar(muchas, meta());
    assert.ok(paginas(largo) >= 3, "páginas: " + paginas(largo));
  });

  test("con nombres con tildes, eñes y símbolos no falla", async () => {
    const raros = [aFilaExport(resumen({ candidato: "Ñandú Ibáñez — «José» ¿qué? 100 % <b>no es HTML</b>", escenario: "Señal débil · “comillas” y ‘apóstrofos’" }))];
    assert.equal((await pdf.generar(raros, meta())).subarray(0, 5).toString(), "%PDF-");
  });
});

describe("exportarInformes", () => {
  const generado = new Date("2026-11-11T01:30:00.000Z");   // en Buenos Aires todavía es el 10
  const pedido = extra => ({ formato: "xlsx", filtro: filtro({ empresa: "MKT Contact Center" }), zona: BSAS, generado, obtenerResumenes: async () => [resumen(), resumen({ candidato: "Tomás Gómez" })], ...extra });

  test("los formatos disponibles son Excel y PDF", () => assert.deepEqual(FORMATOS, ["xlsx", "pdf"]));

  test("devuelve el archivo, su tipo y un nombre con el día de quien exporta", async () => {
    const xlsx = await exportarInformes(pedido());
    assert.equal(xlsx.nombre, "informes-2026-11-10.xlsx");
    assert.equal(xlsx.cantidad, 2);
    assert.match(xlsx.tipoMime, /spreadsheetml/);
    const hoja = (await leerExcel(xlsx.contenido)).getWorksheet("Informes");
    assert.deepEqual([hoja.getCell("B2").value, hoja.getCell("B3").value], ["Lucía Pérez", "Tomás Gómez"]);

    const enPdf = await exportarInformes(pedido({ formato: "pdf", zona: "UTC" }));
    assert.equal(enPdf.nombre, "informes-2026-11-11.pdf", "en UTC ya es el 11");
    assert.equal(enPdf.tipoMime, "application/pdf");
    assert.equal(enPdf.contenido.subarray(0, 5).toString(), "%PDF-");
  });

  test("un formato desconocido se rechaza sin pedir los datos", async () => {
    for (const formato of ["csv", "", undefined, "constructor", "__proto__", "XLSX"]) {
      let pidio = false;
      await assert.rejects(exportarInformes(pedido({ formato, obtenerResumenes: async () => { pidio = true; return []; } })),
        e => e.code === "exportacion_invalida" && /xlsx, pdf/.test(e.message), String(formato));
      assert.equal(pidio, false, String(formato));
    }
  });

  test(`con más de ${MAX_FILAS} informes pide achicar el rango en vez de generar el archivo`, async () => {
    const justo = Array.from({ length: MAX_FILAS }, () => resumen());
    assert.equal((await exportarInformes(pedido({ obtenerResumenes: async () => justo }))).nombre, "informes-2026-11-10.xlsx", "el tope entra");
    await assert.rejects(exportarInformes(pedido({ obtenerResumenes: async () => [...justo, resumen()] })),
      e => e.code === "exportacion_invalida" && e.message.includes(String(MAX_FILAS + 1)) && /Achicá el rango/.test(e.message));
  });

  test("si falla la fuente de datos, el error sale tal cual (no se disfraza de pedido mal hecho)", async () => {
    await assert.rejects(exportarInformes(pedido({ obtenerResumenes: async () => { throw new Error("se cayó la base"); } })), e => e.message === "se cayó la base" && e.code === undefined);
  });
});
