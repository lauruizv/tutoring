/* Pruebas del inicio de la empresa. Las primeras son de la lógica pura
   (backend/src/modules/empresa/inicio.service.js): validación del pedido y armado de la respuesta
   con tres fuentes de mentira, sin base, sin archivos y sin servidor. Las últimas pegan contra el servidor
   (`GET /api/empresa/inicio`); las del bloque "con Postgres" necesitan TEST_DATABASE_URL y si no, se saltean. */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, pedir } from "./helpers.mjs";
import { omitirPg, appConPostgres, cookieDe, crearEmpresa, crearUsuario, simHace, INFORME_PRUEBA } from "./helpers-pg.mjs";

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

test("sin Postgres: la empresa con contraseña recibe 409 y el resto de los roles 403", async () => {
  const app = await startApp();
  try {
    const r = await pedir(app.base, "/api/empresa/inicio");                       // cookie de empresa1
    assert.deepEqual([r.status, r.cuerpo.error.type], [409, "sin_empresa"]);
    assert.equal((await pedir(app.base, "/api/empresa/inicio", { cookie: await app.ingresar("estudiante1") })).status, 403);
    assert.equal((await pedir(app.base, "/api/empresa/inicio", { cookie: null })).status, 401);
  } finally { await app.stop(); }
});

describe("inicio con Postgres", { skip: omitirPg }, () => {
  let pgApp, app, db, A, B, C, uEstC, cEmpA, cEstA, cJuniorA, cEmpB, cEstB, cEmpC;
  const inicio = (cookie, q = "") => pedir(app.base, "/api/empresa/inicio" + q, { cookie });

  before(async () => {
    pgApp = await appConPostgres();
    ({ app, db } = pgApp);
    const cookie = id => cookieDe(pgApp.secreto, id);
    A = await crearEmpresa(db, "Empresa A");
    cEmpA = await cookie(await crearUsuario(db, { empresaId: A, rol: "empresa" }));
    cEstA = await cookie(await crearUsuario(db, { empresaId: A, rol: "estudiante", nombre: "Lucía Paz" }));
    cJuniorA = await cookie(await crearUsuario(db, { empresaId: A, rol: "junior" }));
    await crearUsuario(db, { empresaId: A, rol: "junior" });
    await crearUsuario(db, { empresaId: A, rol: "junior", activo: false });
    B = await crearEmpresa(db, "Empresa B");
    cEmpB = await cookie(await crearUsuario(db, { empresaId: B, rol: "empresa" }));
    cEstB = await cookie(await crearUsuario(db, { empresaId: B, rol: "estudiante" }));
    await crearUsuario(db, { empresaId: B, rol: "junior" });
    C = await crearEmpresa(db, "Empresa C");
    cEmpC = await cookie(await crearUsuario(db, { empresaId: C, rol: "empresa" }));
    uEstC = await crearUsuario(db, { empresaId: C, rol: "estudiante" });
  });
  after(async () => { if (pgApp) await pgApp.cerrar(); });

  test("empresa sin actividad: ceros, lista vacía y solo sus juniors activos", async () => {
    const r = await inicio(cEmpA);
    assert.equal(r.status, 200);
    assert.deepEqual(r.cuerpo, { dias: 30, juniorsEnCapacitacion: 2, simulaciones: { total: 0, enPeriodo: 0 },
      gasto: { moneda: "USD", total: 0, enPeriodo: 0 }, informesRecientes: [] });
  });

  test("después de una simulación: 1 simulación, 2.5 de gasto y el informe en recientes", async () => {
    const { id } = (await pedir(app.base, "/api/informes", { method: "POST", json: INFORME_PRUEBA, cookie: cEstA })).cuerpo;
    const c = (await inicio(cEmpA)).cuerpo;
    assert.deepEqual([c.simulaciones, c.gasto], [{ total: 1, enPeriodo: 1 }, { moneda: "USD", total: 2.5, enPeriodo: 2.5 }]);
    assert.deepEqual(c.informesRecientes, [{ id, candidato: "Lucía Paz", escenario: "Reclamo por doble cobro",
      empresa: "MKT Contact Center", fecha: INFORME_PRUEBA.fecha, puntaje: 78, duracionSeg: INFORME_PRUEBA.duracionSeg }]);
  });

  test("no mezcla empresas, ni muestra archivos rotos, informes viejos o de cuentas con contraseña", async () => {
    await pedir(app.base, "/api/informes", { method: "POST", json: INFORME_PRUEBA, cookie: cEstB });
    await pedir(app.base, "/api/informes", { method: "POST", json: INFORME_PRUEBA, cookie: await app.ingresar("estudiante1") });
    fs.writeFileSync(path.join(app.dataDir, "informes", "roto.json"), "{ esto no es json");
    fs.writeFileSync(path.join(app.dataDir, "informes", "viejo.json"), JSON.stringify({ id: "viejo-0001", candidato: "X", fecha: "2030-01-01T00:00:00.000Z", evaluacion: {} }));
    const a = (await inicio(cEmpA)).cuerpo, b = (await inicio(cEmpB)).cuerpo;
    assert.deepEqual([a.simulaciones.total, a.informesRecientes.length], [1, 1]);
    assert.deepEqual([b.simulaciones.total, b.juniorsEnCapacitacion, b.informesRecientes.length], [1, 1, 1]);
  });

  test("borrar el informe no baja simulaciones ni gasto, pero lo saca de recientes", async () => {
    const id = (await inicio(cEmpA)).cuerpo.informesRecientes[0].id;
    await pedir(app.base, `/api/informes/${id}`, { method: "DELETE", cookie: cEmpA });
    const c = (await inicio(cEmpA)).cuerpo;
    assert.deepEqual([c.simulaciones.total, c.gasto.total, c.informesRecientes], [1, 2.5, []]);
  });

  test("recientes: los 4 más nuevos, del más nuevo al más viejo", async () => {
    for (const d of ["01", "02", "03", "04", "05", "06"])
      await pedir(app.base, "/api/informes", { method: "POST", json: { ...INFORME_PRUEBA, fecha: `2026-10-${d}T12:00:00.000Z` }, cookie: cEstA });
    assert.deepEqual((await inicio(cEmpA)).cuerpo.informesRecientes.map(r => r.fecha.slice(8, 10)), ["06", "05", "04", "03"]);
  });

  test("período: dias filtra simulaciones y gasto; el total no cambia", async () => {
    for (const d of [3, 10, 20, 40]) await simHace(db, C, uEstC, d, 2.5);
    const de = async q => { const c = (await inicio(cEmpC, q)).cuerpo; return [c.dias, c.simulaciones, c.gasto.total, c.gasto.enPeriodo]; };
    assert.deepEqual(await de("?dias=7"),  [7,  { total: 4, enPeriodo: 1 }, 10, 2.5]);
    assert.deepEqual(await de("?dias=15"), [15, { total: 4, enPeriodo: 2 }, 10, 5]);
    assert.deepEqual(await de(""),         [30, { total: 4, enPeriodo: 3 }, 10, 7.5]);
  });

  test("permisos y errores", async () => {
    assert.equal((await inicio(null)).status, 401);
    assert.equal((await inicio(cEstA)).status, 403);
    assert.equal((await inicio(cJuniorA)).status, 403);
    assert.equal((await inicio(cEmpA, "?dias=5")).status, 400);
    assert.equal((await pedir(app.base, "/api/empresa/inicio", { method: "POST", json: {}, cookie: cEmpA })).status, 405);
    const clave = await inicio(await app.ingresar("empresa1"));
    assert.deepEqual([clave.status, clave.cuerpo.error.type], [409, "sin_empresa"]);
  });
});
