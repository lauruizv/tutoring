// Ayudas para las pruebas que usan Postgres: un esquema propio por corrida y atajos para armar datos.
// Sin TEST_DATABASE_URL (o con Docker apagado), `omitirPg` trae el motivo y las pruebas se saltean.
import crypto from "node:crypto";
import pg from "pg";
import { migrar } from "../scripts/db.mjs";
import { crearJwt } from "../backend/src/modules/auth/jwt.js";
import { startApp } from "./helpers.mjs";
import { URL_PRUEBA, motivoParaSaltear } from "./db-prueba.mjs";

export const omitirPg = await motivoParaSaltear();

// Migra un esquema nuevo `prueba_<azar>` y devuelve un cliente conectado a él.
// envDb se vuelca en process.env (o en el env de un proceso hijo) para que el código de la app use ese esquema.
export async function crearEsquema() {
  const esquema = "prueba_" + crypto.randomBytes(4).toString("hex");
  await migrar({ databaseUrl: URL_PRUEBA, schema: esquema });
  const db = new pg.Client({ connectionString: URL_PRUEBA });
  await db.connect();
  await db.query(`SET search_path TO "${esquema}", public`);
  return {
    esquema,
    db,
    envDb: { DATABASE_URL: URL_PRUEBA, DATABASE_SCHEMA: esquema },
    async borrar() {
      await db.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      await db.end();
    }
  };
}

export async function crearEmpresa(db, nombre) {
  return (await db.query("INSERT INTO empresas (nombre) VALUES ($1) RETURNING id", [nombre])).rows[0].id;
}

export async function crearUsuario(db, { empresaId, rol, nombre = "Persona Prueba", activo = true }) {
  const email = `${rol}-${crypto.randomBytes(5).toString("hex")}@prueba.test`;
  return (await db.query(
    "INSERT INTO usuarios (empresa_id, email, nombre, rol, activo) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [empresaId, email, nombre, rol, activo])).rows[0].id;
}

// Una simulación hecha hace `dias` días con ese precio, para armar historia sin esperar.
export async function simHace(db, empresaId, usuarioId, dias, precio) {
  return (await db.query(
    `INSERT INTO simulaciones (empresa_id, usuario_id, escenario_titulo, duracion_seg, precio_usd, realizada_en)
     VALUES ($1, $2, 'Escenario de prueba', 60, $3, now() - make_interval(days => $4::int)) RETURNING id`,
    [empresaId, usuarioId, precio, dias])).rows[0].id;
}

// Cookie de una cuenta de Postgres: el JWT de acceso, firmado con el mismo secreto que usa el servidor.
export async function cookieDe(secreto, usuarioId) {
  const jwt = await crearJwt(secreto).firmar({ usuarioId, tokenVersion: 1, metodo: "google" });
  return `acceso=${jwt}`;
}

// Un servidor de prueba conectado a un esquema propio y con JWT_SECRET. `cerrar()` apaga todo y borra el esquema.
export async function appConPostgres({ env = {} } = {}) {
  const { esquema, db, envDb, borrar } = await crearEsquema();
  const secreto = crypto.randomBytes(48).toString("base64url");
  let app;
  try {
    app = await startApp({ env: { ...envDb, JWT_SECRET: secreto, ...env } });
  } catch (e) {
    await borrar();
    throw e;
  }
  return { app, db, esquema, secreto, async cerrar() { await app.stop(); await borrar(); } };
}

// Un informe como lo manda el navegador al terminar una simulación.
export const INFORME_PRUEBA = {
  fecha: "2026-11-12T18:03:11.000Z",
  duracionSeg: 185,
  empresa: "MKT Contact Center",
  escenario: { titulo: "Reclamo por doble cobro", resumen: "r", cliente: "Marta Díaz", objetivo: "o" },
  criteriosDef: [],
  evaluacion: { resumen: "ok", criterios: [] },
  puntaje: 78
};
