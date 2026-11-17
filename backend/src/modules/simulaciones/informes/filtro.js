// Filtro de la lista de informes. Lógica pura: no sabe de HTTP ni de dónde salen los informes
// (hoy archivos JSON; mañana, una base de datos que traduzca este mismo filtro a su consulta).
//
// Un filtro normalizado tiene siempre estos campos:
//   desde, hasta   instantes ISO o null. Entra lo que cumple  desde <= fecha < hasta.
//                  El navegador manda el comienzo del día "desde" y el comienzo del día siguiente a "hasta",
//                  en la hora de la persona: así "hasta el 10" incluye todo el 10.
//   candidato      texto; alcanza con que el nombre o el mail lo contengan, sin importar tildes ni mayúsculas.
//   escenario      título de la simulación; tiene que ser el título completo.
//   empresa        nombre de la empresa; los informes viejos, sin empresa, pasan igual.
"use strict";

const MAX_TEXTO = 120;

// Sin tildes ni mayúsculas: "perez" encuentra "Pérez".
const plano = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const invalido = mensaje => Object.assign(new Error(mensaje), { code: "filtro_invalido" });

function instante(valor, campo) {
  if (!valor) return null;
  const t = Date.parse(valor);
  if (Number.isNaN(t)) throw invalido(`La fecha "${campo}" no es válida.`);
  return new Date(t).toISOString();
}

// Convierte los parámetros del pedido (URLSearchParams o un objeto común) en un filtro normalizado.
// Si algo no se entiende, tira un error con code "filtro_invalido" y un mensaje para mostrar.
function normalizarFiltro(params) {
  const leer = k => {
    const v = params && (typeof params.get === "function" ? params.get(k) : params[k]);
    return typeof v === "string" ? v.trim().slice(0, MAX_TEXTO) : "";
  };
  const filtro = {
    desde: instante(leer("desde"), "desde"),
    hasta: instante(leer("hasta"), "hasta"),
    candidato: leer("candidato"),
    escenario: leer("escenario"),
    empresa: leer("empresa")
  };
  if (filtro.desde && filtro.hasta && filtro.desde >= filtro.hasta) throw invalido('El rango de fechas está al revés: "desde" tiene que ser anterior a "hasta".');
  return filtro;
}

// ¿El resumen de un informe pasa el filtro?
function cumple(resumen, filtro) {
  if (filtro.desde || filtro.hasta) {
    const t = Date.parse(resumen.fecha);
    if (Number.isNaN(t)) return false;
    if (filtro.desde && t < Date.parse(filtro.desde)) return false;
    if (filtro.hasta && t >= Date.parse(filtro.hasta)) return false;
  }
  if (filtro.candidato) {
    const buscado = plano(filtro.candidato);
    if (!plano(resumen.candidato).includes(buscado) && !plano(resumen.email).includes(buscado)) return false;
  }
  if (filtro.escenario && plano(resumen.escenario) !== plano(filtro.escenario)) return false;
  if (filtro.empresa && resumen.empresa && resumen.empresa !== filtro.empresa) return false;
  return true;
}

module.exports = { normalizarFiltro, cumple };
