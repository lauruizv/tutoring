/* Pruebas de la lógica pura del inicio de la empresa
   (backend/src/modules/empresa/inicio.service.js): validación del pedido y armado de la respuesta
   con tres fuentes de mentira. Sin base, sin archivos y sin servidor. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { crearInicio } = require("../backend/src/modules/empresa/inicio.service.js");

const EMPRESA = { id: "u1", rol: "empresa", empresaId: "emp-1" };
const R1 = { id: "r1", candidato: "Ana Pérez", escenario: "Cobranza", puntaje: 71 };

/* Argumentos con los que se llamó a cada fuente; cada prueba lo vacía al pedir fuentes nuevas. */
const llamadas = {};

function falsas(extra = {}) {
  for (const k of Object.keys(llamadas)) delete llamadas[k];
  return {
    contarJuniors: async (...a) => { llamadas.juniors = a; return 4; },
    resumenSimulaciones: async (...a) => {
      llamadas.resumen = a;
      return { total: 57, enPeriodo: 12, gastoTotal: 142.5, gastoEnPeriodo: 30 };
    },
    informesRecientes: (...a) => { llamadas.recientes = a; return [R1]; },
    ...extra
  };
}

test("arma la respuesta con las tres fuentes", async () => {
  const r = await crearInicio(falsas()).obtener(EMPRESA, null);
  assert.deepEqual(r, { datos: { dias: 30, juniorsEnCapacitacion: 4, simulaciones: { total: 57, enPeriodo: 12 },
    gasto: { moneda: "USD", total: 142.5, enPeriodo: 30 }, informesRecientes: [R1] } });
  assert.deepEqual(llamadas, { juniors: ["emp-1"], resumen: ["emp-1", 30], recientes: ["emp-1", 4] });
});

test("dias: 7, 15 y 30 valen; sin el parámetro, 30", async () => {
  for (const [crudo, n] of [["7", 7], ["15", 15], ["30", 30], [null, 30]])
    assert.equal((await crearInicio(falsas()).obtener(EMPRESA, crudo)).datos.dias, n);
});

test("dias con cualquier otra forma: 400 sin consultar nada", async () => {
  for (const crudo of ["5", "0", "07", "7.0", "30abc", "", " 7", "-7", "abc"]) {
    const r = await crearInicio(falsas()).obtener(EMPRESA, crudo);
    assert.equal(r.error.status, 400, crudo);
    assert.deepEqual(llamadas, {});
  }
});

test("cuenta sin empresa (contraseña o script local): 409 sin_empresa, sin consultar nada", async () => {
  const r = await crearInicio(falsas()).obtener({ id: "u2", rol: "empresa" }, "5");
  assert.deepEqual([r.error.status, r.error.type], [409, "sin_empresa"]);
  assert.deepEqual(llamadas, {});
});

test("si una fuente falla: 503", async (t) => {
  const avisos = t.mock.method(console, "error", () => {});
  for (const cual of ["contarJuniors", "resumenSimulaciones", "informesRecientes"]) {
    const r = await crearInicio(falsas({ [cual]: async () => { throw new Error("se cayó la base"); } })).obtener(EMPRESA, null);
    assert.equal(r.error.status, 503, cual);
  }
  assert.equal(avisos.mock.callCount(), 3);
});

test("montos a dos decimales y nunca más de 4 informes", async () => {
  const r = await crearInicio(falsas({
    resumenSimulaciones: async () => ({ total: 3, enPeriodo: 3, gastoTotal: 7.499999999, gastoEnPeriodo: 0.30000000000000004 }),
    informesRecientes: () => [1, 2, 3, 4, 5, 6]
  })).obtener(EMPRESA, null);
  assert.deepEqual([r.datos.gasto.total, r.datos.gasto.enPeriodo, r.datos.informesRecientes.length], [7.5, 0.3, 4]);
});
