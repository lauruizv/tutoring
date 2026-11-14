/* Lógica del inicio del perfil Empresa: valida el pedido, junta tres fuentes de datos y arma la
   respuesta. Es pura: no importa nada del proyecto, las fuentes llegan por parámetro. */

const DIAS_VALIDOS = { "7": 7, "15": 15, "30": 30 };
const DIAS_POR_DEFECTO = 30;
const INFORMES_RECIENTES = 4;

const redondear = (n) => Math.round(n * 100) / 100;

const SIN_EMPRESA = {
  status: 409,
  type: "sin_empresa",
  message: "El inicio todavía no está disponible para esta cuenta: hace falta una cuenta de empresa que entre con Google."
};
const DIAS_INVALIDOS = { status: 400, message: "El período tiene que ser de 7, 15 o 30 días." };
const FUENTE_CAIDA = { status: 503, message: "No se pudieron leer los datos del inicio. Probá de nuevo en un momento." };

function crearInicio({ contarJuniors, resumenSimulaciones, informesRecientes }) {
  /* `diasCrudo` es lo que devuelve url.searchParams.get("dias"): string o null. */
  async function obtener(yo, diasCrudo) {
    if (!yo || !yo.empresaId) return { error: { ...SIN_EMPRESA } };

    if (diasCrudo !== null && !Object.hasOwn(DIAS_VALIDOS, diasCrudo)) return { error: { ...DIAS_INVALIDOS } };
    const dias = diasCrudo === null ? DIAS_POR_DEFECTO : DIAS_VALIDOS[diasCrudo];

    const id = yo.empresaId;
    let juniors, resumen, recientes;
    try {
      /* Cada fuente arranca dentro de una promesa: si una tira sin ser async, no deja a las otras sueltas. */
      [juniors, resumen, recientes] = await Promise.all([
        Promise.resolve().then(() => contarJuniors(id)),
        Promise.resolve().then(() => resumenSimulaciones(id, dias)),
        Promise.resolve().then(() => informesRecientes(id, INFORMES_RECIENTES))
      ]);
    } catch (e) {
      console.error("[empresa] no se pudo armar el inicio:", e && e.message ? e.message : e);
      return { error: { ...FUENTE_CAIDA } };
    }

    return {
      datos: {
        dias,
        juniorsEnCapacitacion: juniors,
        simulaciones: { total: resumen.total, enPeriodo: resumen.enPeriodo },
        gasto: { moneda: "USD", total: redondear(resumen.gastoTotal), enPeriodo: redondear(resumen.gastoEnPeriodo) },
        informesRecientes: recientes.slice(0, INFORMES_RECIENTES)
      }
    };
  }

  return { obtener };
}

module.exports = { crearInicio };
