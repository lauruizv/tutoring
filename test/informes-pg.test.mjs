// Al guardar un informe, una cuenta de Postgres deja registrada la simulación (con su precio).
// Necesita TEST_DATABASE_URL (Postgres); sin eso, se saltea.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pedir } from "./helpers.mjs";
import { omitirPg, appConPostgres, cookieDe, crearEmpresa, crearUsuario, INFORME_PRUEBA } from "./helpers-pg.mjs";

describe("informes con Postgres", { skip: omitirPg }, () => {
  let pgApp, app, db, A, uEst, cEst, cEmp;
  const cuantas = async () => Number((await db.query("SELECT count(*) AS n FROM simulaciones")).rows[0].n);
  const archivos = () => fs.readdirSync(path.join(app.dataDir, "informes"));

  before(async () => {
    pgApp = await appConPostgres();
    ({ app, db } = pgApp);
    A = await crearEmpresa(db, "Empresa A");
    uEst = await crearUsuario(db, { empresaId: A, rol: "estudiante" });
    const uEmp = await crearUsuario(db, { empresaId: A, rol: "empresa" });
    cEst = await cookieDe(pgApp.secreto, uEst);
    cEmp = await cookieDe(pgApp.secreto, uEmp);
  });
  after(async () => { if (pgApp) await pgApp.cerrar(); });

  test("una cuenta de Postgres guarda un informe: queda la simulación con su precio", async () => {
    const falso = { simulacionId: "falso", empresaId: "otra-empresa", precioUsd: 0, precio_usd: 0 };
    const r = await pedir(app.base, "/api/informes", { method: "POST", json: { ...INFORME_PRUEBA, ...falso }, cookie: cEst });
    assert.equal(r.status, 200);
    const sim = (await db.query("SELECT id, empresa_id, usuario_id, precio_usd, escenario_titulo, duracion_seg FROM simulaciones")).rows;
    assert.equal(sim.length, 1);
    assert.deepEqual([sim[0].empresa_id, sim[0].usuario_id, sim[0].precio_usd, sim[0].escenario_titulo, sim[0].duracion_seg],
      [A, uEst, "2.50", "Reclamo por doble cobro", 185]);
    const inf = (await pedir(app.base, `/api/informes/${r.cuerpo.id}`, { cookie: cEst })).cuerpo;
    assert.deepEqual([inf.simulacionId, inf.empresaId, inf.candidato], [sim[0].id, A, "Persona Prueba"]);
  });

  test("una cuenta con contraseña guarda como hoy y no registra nada", async () => {
    const antes = await cuantas();
    const r = await pedir(app.base, "/api/informes", { method: "POST",
      json: { ...INFORME_PRUEBA, simulacionId: "falso", empresaId: A }, cookie: await app.ingresar("estudiante1") });
    assert.equal(r.status, 200);
    assert.equal(await cuantas(), antes);
    const guardado = JSON.parse(fs.readFileSync(path.join(app.dataDir, "informes", r.cuerpo.id + ".json"), "utf8"));
    assert.ok(!("simulacionId" in guardado) && !("empresaId" in guardado));
  });

  test("borrar el informe no borra la simulación", async () => {
    const r = await pedir(app.base, "/api/informes", { method: "POST", json: INFORME_PRUEBA, cookie: cEst });
    const antes = await cuantas();
    assert.equal((await pedir(app.base, `/api/informes/${r.cuerpo.id}`, { method: "DELETE", cookie: cEmp })).status, 200);
    assert.equal(await cuantas(), antes);
  });

  test("si no se puede registrar la simulación, el informe no se guarda", async () => {
    const antes = archivos().length;
    await db.query("ALTER TABLE simulaciones RENAME TO simulaciones_rota");
    try {
      const r = await pedir(app.base, "/api/informes", { method: "POST", json: INFORME_PRUEBA, cookie: cEst });
      assert.equal(r.status, 503);
      assert.equal(archivos().length, antes);
    } finally { await db.query("ALTER TABLE simulaciones_rota RENAME TO simulaciones"); }
  });

  test("si no se puede guardar el informe, la simulación se anula", async () => {   // va última: rompe la carpeta
    const antes = await cuantas();
    const dir = path.join(app.dataDir, "informes");
    fs.rmSync(dir, { recursive: true }); fs.writeFileSync(dir, "");               // un archivo donde iba la carpeta
    try {
      const r = await pedir(app.base, "/api/informes", { method: "POST", json: INFORME_PRUEBA, cookie: cEst });
      assert.equal(r.status, 500);
      assert.equal(await cuantas(), antes);
    } finally { fs.rmSync(dir); fs.mkdirSync(dir); }
  });
});
