// Exportación del listado de informes a un archivo (Excel o PDF).
//
// Son tres pasos que no se conocen entre sí:
//   1. obtener los resúmenes   lo hace quien llama, con la función `obtenerResumenes` (hoy lee archivos; mañana, una base de datos)
//   2. pasarlos a filas        lib/informes/dto.js (el único lugar que sabe qué columnas hay)
//   3. generar el archivo      un exportador por formato, todos con la misma forma:
//                              { extension, tipoMime, generar(filas, meta) → Buffer }
// Para sumar un formato (CSV, por ejemplo) alcanza con otro archivo y una línea en EXPORTADORES.
"use strict";

const { aFilaExport } = require("../informes/dto");
const { zonaValida, describirFiltro, diaIso } = require("./formato");

// Tope de informes por archivo: una exportación gigante no tiene que dejar al servidor sin memoria.
const MAX_FILAS = 5000;

// Los exportadores cargan su librería recién al generar: tenerlos acá no pesa al arrancar el servidor.
const EXPORTADORES = new Map([
  ["xlsx", require("./excel")],
  ["pdf", require("./pdf")]
]);
const FORMATOS = [...EXPORTADORES.keys()];

// Error por algo que pidió mal quien exporta (se le muestra el mensaje); no es una falla del servidor.
const invalida = mensaje => Object.assign(new Error(mensaje), { code: "exportacion_invalida" });

// Arma el archivo. Devuelve { contenido (Buffer), tipoMime, nombre, cantidad (de informes) }.
//   formato            "xlsx" | "pdf"
//   filtro             filtro normalizado (lib/informes/filtro.js); se usa para pedir los datos y para describirlos en el archivo
//   zona               zona horaria de quien exporta: las fechas salen en su hora
//   obtenerResumenes   función asíncrona que devuelve los resúmenes ya filtrados
//   generado           cuándo se genera (se puede fijar en las pruebas)
async function exportarInformes({ formato, filtro, zona, obtenerResumenes, generado = new Date() }) {
  // El formato se revisa antes de pedir los datos: por un pedido mal hecho no se lee nada.
  const exportador = EXPORTADORES.get(formato);
  if (!exportador) throw invalida(`Formato de exportación desconocido. Los disponibles son: ${FORMATOS.join(", ")}.`);

  const resumenes = await obtenerResumenes();
  if (resumenes.length > MAX_FILAS) {
    throw invalida(`Hay ${resumenes.length} informes con estos filtros y se exportan hasta ${MAX_FILAS} por archivo. Achicá el rango de fechas.`);
  }

  const zonaDeQuienExporta = zonaValida(zona);
  const meta = { empresa: filtro.empresa, generado, zona: zonaDeQuienExporta, filtros: describirFiltro(filtro, zonaDeQuienExporta) };
  const contenido = await exportador.generar(resumenes.map(aFilaExport), meta);
  return { contenido, tipoMime: exportador.tipoMime, nombre: `informes-${diaIso(generado, zonaDeQuienExporta)}.${exportador.extension}`, cantidad: resumenes.length };
}

module.exports = { exportarInformes, FORMATOS, MAX_FILAS };
