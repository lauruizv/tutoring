// Formatos que comparten los exportadores: fechas en la hora de quien exporta, duraciones
// y la descripción de los filtros que tenía puestos.
"use strict";

const ZONA_POR_DEFECTO = "America/Argentina/Buenos_Aires";

// El archivo lo arma el servidor, pero las fechas tienen que salir en la hora de quien lo pide:
// el navegador manda su zona ("America/Argentina/Buenos_Aires"). Si falta o no existe, se usa la de por defecto.
function zonaValida(zona) {
  if (typeof zona !== "string" || !zona || zona.length > 64) return ZONA_POR_DEFECTO;
  try { new Intl.DateTimeFormat("es-AR", { timeZone: zona }); return zona; }
  catch (_) { return ZONA_POR_DEFECTO; }
}

// La hora de reloj de un instante en una zona: { anio, mes, dia, hora, minuto, segundo }.
function relojDe(fecha, zona) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(fecha);
  const n = tipo => Number(partes.find(p => p.type === tipo).value);
  return { anio: n("year"), mes: n("month"), dia: n("day"), hora: n("hour"), minuto: n("minute"), segundo: n("second") };
}

const dos = n => String(n).padStart(2, "0");
// "10/11/2026"
const dia = (fecha, zona) => { const r = relojDe(fecha, zona); return `${dos(r.dia)}/${dos(r.mes)}/${r.anio}`; };
// "10/11/2026 12:05"
const diaHora = (fecha, zona) => { const r = relojDe(fecha, zona); return `${dos(r.dia)}/${dos(r.mes)}/${r.anio} ${dos(r.hora)}:${dos(r.minuto)}`; };
// "2026-11-10" (para el nombre del archivo)
const diaIso = (fecha, zona) => { const r = relojDe(fecha, zona); return `${r.anio}-${dos(r.mes)}-${dos(r.dia)}`; };
// 245 segundos → "4:05"
const duracion = seg => `${Math.floor(seg / 60)}:${dos(Math.floor(seg % 60))}`;

// Los filtros que tenía puestos quien exporta, como pares [nombre, valor] para mostrar en el archivo.
function describirFiltro(filtro, zona) {
  const lineas = [];
  if (filtro.desde) lineas.push(["Desde", dia(new Date(filtro.desde), zona)]);
  // "hasta" es el comienzo del día siguiente al elegido (ver lib/informes/filtro.js): se muestra el último día que entra.
  if (filtro.hasta) lineas.push(["Hasta", dia(new Date(Date.parse(filtro.hasta) - 1), zona)]);
  if (filtro.escenario) lineas.push(["Simulación", filtro.escenario]);
  if (filtro.candidato) lineas.push(["Candidato", `contiene “${filtro.candidato}”`]);
  return lineas;
}

module.exports = { ZONA_POR_DEFECTO, zonaValida, relojDe, dia, diaHora, diaIso, duracion, describirFiltro };
