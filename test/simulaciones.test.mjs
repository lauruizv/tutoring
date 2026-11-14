// Registro de simulaciones y resumen por empresa. El de la base necesita TEST_DATABASE_URL; sin eso, se saltea.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { omitirPg, crearEsquema, crearEmpresa, crearUsuario, simHace } from "./helpers-pg.mjs";

const require = createRequire(import.meta.url);

test("el precio vigente es 2.5 USD", async () => {
  const s = require("../backend/src/modules/simulaciones/services/simulaciones.service.js");
  assert.equal(s.PRECIO_SIMULACION_USD, 2.5);
  assert.equal(await s.precioVigenteUsd(), 2.5);
});

describe("simulaciones en Postgres", { skip: omitirPg }, () => {
  let e, svc, cerrarPool;
  let A, B, P, G, D, VACIA, uA, uB, uP, uG, uD;
  const fila = async id => (await e.db.query("SELECT * FROM simulaciones WHERE id = $1", [id])).rows[0];

  before(async () => {
    e = await crearEsquema();
    Object.assign(process.env, e.envDb);
    svc = require("../backend/src/modules/simulaciones/services/simulaciones.service.js");
    ({ cerrarPool } = require("../backend/src/shared/db.js"));
    const nueva = async nombre => {
      const empresaId = await crearEmpresa(e.db, nombre);
      return [empresaId, await crearUsuario(e.db, { empresaId, rol: "estudiante" })];
    };
    [A, uA] = await nueva("Empresa A");
    [B, uB] = await nueva("Empresa B");
    [P, uP] = await nueva("Empresa P");
    [G, uG] = await nueva("Empresa G");
    [D, uD] = await nueva("Empresa D");
    VACIA = await crearEmpresa(e.db, "Empresa vacía");
  });
  after(async () => {
    if (cerrarPool) await cerrarPool();
    if (e) await e.borrar();
  });

  test("registrar guarda la fila con el precio vigente y la copia del escenario", async () => {
    const id = await svc.registrar({ empresaId: A, usuarioId: uA, informe: {
      escenario: { titulo: "Reclamo por doble cobro", resumen: "r", cliente: "Marta Díaz", objetivo: "o" }, duracionSeg: 185 } });
    const f = await fila(id);
    assert.equal(f.precio_usd, "2.50");
    assert.deepEqual([f.empresa_id, f.usuario_id, f.escenario_id], [A, uA, null]);
    assert.deepEqual([f.escenario_titulo, f.escenario_resumen, f.escenario_cliente, f.escenario_objetivo, f.duracion_seg],
      ["Reclamo por doble cobro", "r", "Marta Díaz", "o", 185]);
  });

  test("un informe con escenario o duración rotos se registra igual", async () => {
    const casos = [
      [{}, "Sin título", 0],
      [{ escenario: null, duracionSeg: -5 }, "Sin título", 0],
      [{ escenario: { titulo: "   " }, duracionSeg: "abc" }, "Sin título", 0],
      [{ escenario: { titulo: 42 }, duracionSeg: 1e12 }, "Sin título", 86400],
      [{ escenario: { titulo: "x".repeat(5000) }, duracionSeg: 90.6 }, "x".repeat(200), 91]
    ];
    for (const [informe, titulo, seg] of casos) {
      const f = await fila(await svc.registrar({ empresaId: A, usuarioId: uA, informe }));
      assert.deepEqual([f.escenario_titulo, f.duracion_seg, f.escenario_resumen], [titulo, seg, null]);
    }
  });

  test("resumen de una empresa sin simulaciones: ceros", async () => {
    assert.deepEqual(await svc.resumen(VACIA, 30), { total: 0, enPeriodo: 0, gastoTotal: 0, gastoEnPeriodo: 0 });
  });

  test("resumen por período: ventana corrida de 7, 15 y 30 días", async () => {
    for (const d of [3, 10, 20, 40]) await simHace(e.db, P, uP, d, 2.5);
    assert.deepEqual(await svc.resumen(P, 7),  { total: 4, enPeriodo: 1, gastoTotal: 10, gastoEnPeriodo: 2.5 });
    assert.deepEqual(await svc.resumen(P, 15), { total: 4, enPeriodo: 2, gastoTotal: 10, gastoEnPeriodo: 5 });
    assert.deepEqual(await svc.resumen(P, 30), { total: 4, enPeriodo: 3, gastoTotal: 10, gastoEnPeriodo: 7.5 });
  });

  test("el gasto es la suma de lo guardado, no cantidad por precio de hoy", async () => {
    for (const p of [1, 2.5, 4]) await simHace(e.db, G, uG, 1, p);
    assert.equal((await svc.resumen(G, 30)).gastoTotal, 7.5);
    for (const p of [0.1, 0.2]) await simHace(e.db, D, uD, 1, p);
    assert.equal((await svc.resumen(D, 30)).gastoTotal, 0.3);
  });

  test("no mezcla empresas", async () => {
    await simHace(e.db, B, uB, 1, 2.5);
    assert.equal((await svc.resumen(VACIA, 30)).total, 0);
    assert.equal((await svc.resumen(B, 30)).total, 1);
  });

  test("anular borra la fila y no tira si ya no existe", async t => {
    const id = await svc.registrar({ empresaId: A, usuarioId: uA, informe: {} });
    await svc.anular(id);
    assert.equal(await fila(id), undefined);
    await svc.anular(id);
    // Un id que no es uuid hace fallar a la base: anular no tira, deja una línea con console.error.
    const error = t.mock.method(console, "error", () => {});
    await svc.anular("no-es-un-uuid");
    assert.equal(error.mock.callCount(), 1);
  });
});
