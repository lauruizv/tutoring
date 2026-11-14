// Registro de simulaciones y resumen de una empresa (cuántas hizo y cuánto gastó).
// El precio se congela en cada fila al registrarla: si después cambia, lo ya hecho no se mueve.
const repo = require("../repositories/simulaciones-pg.repository");

// PROVISORIO. A futuro el precio se edita desde un panel de administración y se lee de la base.
// Por eso todo el código lo pide con precioVigenteUsd() y nadie lee esta constante directo.
const PRECIO_SIMULACION_USD = 2.5;

async function precioVigenteUsd() {
  return PRECIO_SIMULACION_USD;
}

// Los datos vienen del informe que arma el navegador: no se confía en su forma.
const texto = (v, max) => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
};
const duracion = v => (typeof v === "number" && Number.isFinite(v) ? Math.min(86400, Math.max(0, Math.round(v))) : 0);

// La empresa y la persona las pone el servidor (sesión), nunca el navegador. Devuelve el id de la simulación.
// Si la base falla, el error se propaga: quien llama decide qué hacer.
async function registrar({ empresaId, usuarioId, informe }) {
  const esc = informe && typeof informe.escenario === "object" && informe.escenario ? informe.escenario : {};
  return repo.insertar({
    empresaId,
    usuarioId,
    escenarioTitulo: texto(esc.titulo, 200) || "Sin título",
    escenarioResumen: texto(esc.resumen, 2000),
    escenarioCliente: texto(esc.cliente, 2000),
    escenarioObjetivo: texto(esc.objetivo, 2000),
    duracionSeg: duracion(informe && informe.duracionSeg),
    precioUsd: await precioVigenteUsd()
  });
}

// Deshace un registro (por ejemplo, si no se pudo guardar el informe). Nunca tira: solo avisa en el log.
async function anular(id) {
  try {
    await repo.borrar(id);
  } catch (e) {
    console.error("[simulaciones] no se pudo anular la simulación", id, "-", e.message);
  }
}

const resumen = (empresaId, dias) => repo.resumen(empresaId, dias);

module.exports = { PRECIO_SIMULACION_USD, precioVigenteUsd, registrar, anular, resumen };
