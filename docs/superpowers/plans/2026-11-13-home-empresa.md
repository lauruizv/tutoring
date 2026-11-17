# Home del perfil Empresa (backend) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un pedido `GET /api/empresa/inicio` que le devuelve a la empresa sus juniors en capacitación, simulaciones realizadas, gasto e informes recientes, con cada simulación registrada en Postgres al precio del día en que se hizo.

**Architecture:** Al guardar un informe (`POST /api/informes`), el servidor inserta una fila en la tabla `simulaciones` con `precio_usd` congelado. El inicio es un service puro del módulo `empresa` que recibe tres funciones (juniors, resumen de simulaciones, informes recientes); `backend/src/routes.js` se las pasa desde `auth` y `simulaciones`, así ningún módulo importa de otro. Los informes siguen en JSON.

**Tech Stack:** Node ≥ 22, CommonJS, `http` nativo, `pg`, `node-pg-migrate`, `node --test`, Postgres 17 en Docker para las pruebas.

**Spec:** `docs/superpowers/specs/2026-11-13-home-empresa-design.md`

## Global Constraints

- Sin dependencias nuevas. Backend en CommonJS; pruebas en `.mjs` con `node --test`.
- Comentarios, mensajes de error y documentación en español rioplatense.
- Un módulo de `backend/src/modules/` no importa de otro; `shared/` no importa de `modules/`. Lo que cruza módulos se junta en `backend/src/routes.js`.
- Sin Postgres todo sigue como hoy: `npm start`, `npm run demo` y `npm test` sin `TEST_DATABASE_URL` (las pruebas de la base se saltean, no fallan).
- El navegador nunca decide el precio, la empresa ni la simulación de un informe.
- Valores fijos: precio `2.5` USD (`PRECIO_SIMULACION_USD`, provisorio); `dias` es `7`, `15` o `30`, por defecto `30`; 4 informes recientes; moneda `"USD"`; 409 con `type: "sin_empresa"`; migración `0005_precio_de_simulacion`.
- **Git:** el árbol tiene cambios ajenos sin commitear (`.env.example`, `CLAUDE.md`, `backend/server.js`, `backend/src/app.js`, `backend/src/shared/http/proxy.js`, `test/despliegue.test.mjs`, `infra/LEEME.md`). Nunca `git add -A` ni `git add .`: cada commit agrega solo los archivos de su tarea. Mensajes en español, estilo `feat(ámbito): …`, terminados con `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- **Pruebas con base:** cada comando lleva adelante `TEST_DATABASE_URL=postgres://tutoring:tutoring-dev@localhost:55432/tutoring` (abajo, `PG=…`). El ambiente del shell no se conserva entre comandos: escribirlo completo cada vez.

## Review Focus

Entradas que el spec implica y que más pueden morder. Cada una tiene su prueba en la tarea indicada.

1. **`dias` con formas raras** (`"07"`, `"7.0"`, `"30abc"`, `""`, `" 7"`, `"-7"`): 400, sin consultar ninguna fuente. Solo `7`, `15` y `30` escritos exactos valen; sin el parámetro, 30. → Task 4.
2. **Informe con `escenario` o `duracionSeg` rotos** (falta, `null`, título vacío o no texto, título de 5000 caracteres, duración negativa, no numérica o enorme): la simulación se registra igual, con "Sin título", duración entre 0 y 86400 y textos recortados. → Task 2.
3. **Lo que hay en `data/informes` y no es de la empresa:** archivos rotos, informes viejos sin `empresaId`, informes de cuentas con contraseña e informes de otra empresa. El inicio responde 200 y no los muestra. → Task 5.
4. **Montos que no suman exacto en binario** (0,10 + 0,20): el gasto es 0.3, no 0.30000000000000004. → Task 2 y Task 4.
5. **Una fuente falla después de autenticar** (la base se cae): el inicio responde 503; al guardar un informe, 503 sin informe a medias, y si lo que falla es el archivo, la simulación no queda cobrada. → Task 3 y Task 4.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `db/migrations/0005_precio_de_simulacion.sql` (nuevo) | Columna `precio_usd` en `simulaciones`. |
| `backend/src/modules/simulaciones/repositories/simulaciones-pg.repository.js` (nuevo) | SQL de la tabla `simulaciones`: insertar, borrar, resumen. |
| `backend/src/modules/simulaciones/services/simulaciones.service.js` (nuevo) | Precio vigente, saneado de lo que viene del informe, registrar, anular, resumen. |
| `backend/src/modules/simulaciones/services/informes.service.js` | `crear` registra la simulación; `recientes`. |
| `backend/src/modules/simulaciones/controllers/informes.controller.js` | Espera a `crear`. |
| `backend/src/modules/auth/usuarios-pg.repository.js` | `contarActivosPorRol`. |
| `backend/src/modules/empresa/inicio.service.js` (nuevo) | Lógica pura del inicio: valida, junta, arma la respuesta. |
| `backend/src/modules/empresa/inicio.controller.js` (nuevo) | Pedido → service → respuesta. |
| `backend/src/modules/empresa/inicio.routes.js` (nuevo) | Recibe las fuentes y devuelve la tabla de rutas. |
| `backend/src/routes.js` | Le pasa las fuentes al inicio. |
| `test/helpers-pg.mjs` (nuevo) | Esquema de prueba, empresas, usuarios, cookies y app con Postgres. |
| `test/simulaciones.test.mjs`, `test/informes-pg.test.mjs`, `test/inicio.test.mjs` (nuevos) | Pruebas de las tareas 2, 3 y 4–5. |
| `test/db.test.mjs`, `package.json`, `CLAUDE.md` | Migración 5, pruebas nuevas en `npm test`, documentación. |

---

### Task 1: Entorno y migración 0005

**Files:**
- Create: `db/migrations/0005_precio_de_simulacion.sql`
- Modify: `test/db.test.mjs`

**Interfaces:**
- Produces: columna `simulaciones.precio_usd numeric(10, 2) NOT NULL CHECK (precio_usd >= 0)`, sin `DEFAULT`.

- [ ] **Step 1: Preparar el entorno**

En `node_modules` faltan `pg`, `node-pg-migrate` y `google-auth-library` (el `package.json` de `master` los pide).

```bash
npm ci
docker compose --env-file /dev/null up -d      # --env-file: docker compose no puede leer el .env del repo
docker compose --env-file /dev/null ps          # esperar a que db diga "healthy"
```

- [ ] **Step 2: Anotar la base de comparación**

Run: `npm test` y después `PG=… npm test`.
Expected: anotar pasan/fallan de cada corrida. Según la Bitácora, la única falla conocida es `estáticos: sirve la app y bloquea salir de /public`. Estos dos resultados son la referencia de todo el plan: ninguna tarea puede sumar fallas.

- [ ] **Step 3: Escribir las pruebas que fallan** en `test/db.test.mjs`

Cambiar las dos pruebas existentes para que esperen 5 migraciones (título "lista las 5 migraciones…", agregar `"0005_precio_de_simulacion"` al final de la lista, y `.length, 5`). Agregar al final:

```js
test("simulaciones exige precio_usd: sin valor por defecto y sin negativos", { skip: omitir }, async () => {
  const c = await conectar();
  await c.query(`SET search_path TO "${ESQUEMA}", public`);
  const emp = (await c.query("INSERT INTO empresas (nombre) VALUES ('Precio') RETURNING id")).rows[0].id;
  const usu = (await c.query("INSERT INTO usuarios (empresa_id, email, nombre, rol) VALUES ($1, 'precio@prueba.com', 'Pre Cio', 'estudiante') RETURNING id", [emp])).rows[0].id;
  const insertar = precio => c.query(
    `INSERT INTO simulaciones (empresa_id, usuario_id, escenario_titulo, duracion_seg${precio === undefined ? "" : ", precio_usd"})
     VALUES ($1, $2, 'Título', 60${precio === undefined ? "" : ", " + precio}) RETURNING precio_usd`, [emp, usu]);
  await assert.rejects(insertar(), /precio_usd/);
  await assert.rejects(insertar(-1), /simulaciones_precio_usd_check/);
  assert.equal((await insertar(2.5)).rows[0].precio_usd, "2.50");
});
```

- [ ] **Step 4: Verificar que fallan**

Run: `PG=… node --test test/db.test.mjs`
Expected: FAIL (4 migraciones en vez de 5; el `INSERT` sin precio no se rechaza).

- [ ] **Step 5: Crear la migración**

`db/migrations/0005_precio_de_simulacion.sql`, con el formato de las anteriores (`-- Up Migration`, comentario en español que diga: copia congelada de lo que se le cobra a la empresa por esa simulación; sin `DEFAULT` a propósito, para que nadie inserte sin decir el precio):

```sql
ALTER TABLE simulaciones
  ADD COLUMN precio_usd numeric(10, 2) NOT NULL CHECK (precio_usd >= 0);
```

- [ ] **Step 6: Verificar que pasan**

Run: `PG=… node --test test/db.test.mjs test/login-google.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0005_precio_de_simulacion.sql test/db.test.mjs
git commit -m "feat(db): precio congelado en cada simulación (migración 0005)"
```

---

### Task 2: Registro y resumen de simulaciones

**Files:**
- Create: `backend/src/modules/simulaciones/repositories/simulaciones-pg.repository.js`
- Create: `backend/src/modules/simulaciones/services/simulaciones.service.js`
- Create: `test/helpers-pg.mjs`
- Create: `test/simulaciones.test.mjs`
- Modify: `package.json` (sumar `test/simulaciones.test.mjs` a `test` y a `test:todo`)

**Interfaces:**
- Consumes: `query`, `cerrarPool` de `backend/src/shared/db.js`; `migrar` de `scripts/db.mjs`; `URL_PRUEBA`, `motivoParaSaltear` de `test/db-prueba.mjs`.
- Produces, repositorio:
  - `insertar({ empresaId, usuarioId, escenarioTitulo, escenarioResumen, escenarioCliente, escenarioObjetivo, duracionSeg, precioUsd }) → Promise<string>` (id de la fila; `escenario_id` queda `NULL`, `realizada_en` la pone la base)
  - `borrar(id) → Promise<void>`
  - `resumen(empresaId, dias) → Promise<{ total, enPeriodo, gastoTotal, gastoEnPeriodo }>`, los cuatro como `number`
- Produces, service:
  - `PRECIO_SIMULACION_USD = 2.5`
  - `precioVigenteUsd() → Promise<number>`
  - `registrar({ empresaId, usuarioId, informe }) → Promise<string>` (id). Toma `informe.escenario` e `informe.duracionSeg`, los sanea y usa `precioVigenteUsd()`. Propaga el error de la base.
  - `anular(id) → Promise<void>`. Nunca tira: si falla, deja una línea con `console.error`.
  - `resumen(empresaId, dias)`: el del repositorio.
- Produces, `test/helpers-pg.mjs`:
  - `omitirPg`: `false` o el motivo, para `{ skip: omitirPg }`
  - `crearEsquema() → Promise<{ esquema, db, envDb, borrar() }>`: migra un esquema `prueba_<azar>`; `db` es un `pg.Client` con el `search_path` puesto; `envDb = { DATABASE_URL, DATABASE_SCHEMA }`
  - `crearEmpresa(db, nombre) → Promise<string>`
  - `crearUsuario(db, { empresaId, rol, nombre = "Persona Prueba", activo = true }) → Promise<string>` (email único al azar, en minúsculas)
  - `simHace(db, empresaId, usuarioId, dias, precio) → Promise<string>`: `INSERT` directo en `simulaciones` con `realizada_en = now() - dias` días y ese `precio_usd` (para armar historia sin esperar)

Saneado en el service: título = texto recortado a 200 caracteres, o `"Sin título"` si falta, no es texto o queda vacío; resumen, cliente y objetivo = texto recortado a 2000, o `null`; duración = entero entre `0` y `86400` (lo no numérico vale `0`).

- [ ] **Step 1: Escribir `test/helpers-pg.mjs`** con las cinco exportaciones de arriba (mismo patrón que `test/login-google.test.mjs`: `migrar({ databaseUrl, schema })`, `DROP SCHEMA … CASCADE` en `borrar()`).

- [ ] **Step 2: Escribir las pruebas que fallan** en `test/simulaciones.test.mjs`

Fuera del bloque con base (corre siempre):

```js
test("el precio vigente es 2.5 USD", async () => {
  const s = require("../backend/src/modules/simulaciones/services/simulaciones.service.js");
  assert.equal(s.PRECIO_SIMULACION_USD, 2.5);
  assert.equal(await s.precioVigenteUsd(), 2.5);
});
```

Bloque `describe("simulaciones en Postgres", { skip: omitirPg }, …)`. En `before`: `e = await crearEsquema()`, `Object.assign(process.env, e.envDb)` y recién ahí `require` del service. En `after`: `cerrarPool()` y `e.borrar()`. `fila(id)` lee la fila por id con `e.db`.

```js
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

test("anular borra la fila y no tira si ya no existe", async () => {
  const id = await svc.registrar({ empresaId: A, usuarioId: uA, informe: {} });
  await svc.anular(id);
  assert.equal(await fila(id), undefined);
  await svc.anular(id);
  await svc.anular("no-es-un-uuid");
});
```

Cada letra (`A`, `B`, `P`, `G`, `D`, `VACIA`) es una empresa propia creada en `before`, con su usuario estudiante (`uA`, …), para que las pruebas no se pisen.

- [ ] **Step 3: Verificar que fallan**

Run: `PG=… node --test test/simulaciones.test.mjs`
Expected: FAIL con "Cannot find module … simulaciones.service.js".

- [ ] **Step 4: Implementar el repositorio**

`resumen` es una sola consulta sobre `WHERE empresa_id = $1`, con `count(*)` y `coalesce(sum(precio_usd), 0)` totales y con `FILTER (WHERE realizada_en >= now() - make_interval(days => $2))`. Postgres devuelve `count` y `numeric` como texto: convertir a `number` antes de devolver. Valores siempre como parámetros (`$1`, `$2`).

- [ ] **Step 5: Implementar el service**

La constante lleva un comentario que diga que es provisoria y que a futuro el precio se edita desde un panel de administración y se lee de la base: por eso todo el código lo pide por `precioVigenteUsd()` y nadie lee la constante directo.

- [ ] **Step 6: Verificar que pasan**

Run: `PG=… node --test test/simulaciones.test.mjs` → PASS.
Run: `node --test test/simulaciones.test.mjs` → pasa "el precio vigente…" y el resto figura como salteado.

- [ ] **Step 7: Sumar la prueba a `npm test` y `test:todo`** en `package.json`, y commit

```bash
git add backend/src/modules/simulaciones/repositories/simulaciones-pg.repository.js \
  backend/src/modules/simulaciones/services/simulaciones.service.js \
  test/helpers-pg.mjs test/simulaciones.test.mjs package.json
git commit -m "feat(simulaciones): registro de simulaciones en Postgres con su precio"
```

---

### Task 3: Registrar la simulación al guardar el informe

**Files:**
- Modify: `backend/src/modules/simulaciones/services/informes.service.js` (función `crear`)
- Modify: `backend/src/modules/simulaciones/controllers/informes.controller.js` (función `crear`)
- Modify: `test/helpers-pg.mjs`
- Create: `test/informes-pg.test.mjs`
- Modify: `package.json` (sumar `test/informes-pg.test.mjs` a `test` y a `test:todo`)

**Interfaces:**
- Consumes: `registrar`, `anular` de `simulaciones.service.js` (Task 2); `crearJwt` de `backend/src/modules/auth/jwt.js`; `startApp`, `pedir` de `test/helpers.mjs`.
- Produces:
  - `informes.service.crear(r, yo) → Promise<{ id } | { error: { status, message } }>` (antes era síncrona). Los informes de cuentas de Postgres se guardan con `simulacionId` y `empresaId`.
  - En `test/helpers-pg.mjs`:
    - `cookieDe(secreto, usuarioId) → Promise<string>`: `"acceso=<jwt>"`, firmado con `crearJwt(secreto).firmar({ usuarioId, tokenVersion: 1, metodo: "google" })`
    - `appConPostgres({ env = {} } = {}) → Promise<{ app, db, esquema, secreto, cerrar() }>`: `crearEsquema()` + `startApp({ env: { ...envDb, JWT_SECRET: secreto, ...env } })`, con `secreto` de 48 bytes al azar en base64url
    - `INFORME_PRUEBA`: `{ fecha: "2026-11-12T18:03:11.000Z", duracionSeg: 185, empresa: "MKT Contact Center", escenario: { titulo: "Reclamo por doble cobro", resumen: "r", cliente: "Marta Díaz", objetivo: "o" }, criteriosDef: [], evaluacion: { resumen: "ok", criterios: [] }, puntaje: 78 }`

Comportamiento de `crear`, en este orden (spec, "Cuándo se registra una simulación"):

1. Las validaciones de hoy, sin cambios.
2. Borrar `r.simulacionId` y `r.empresaId`, vengan o no.
3. Si `yo.empresaId`: `registrar({ empresaId: yo.empresaId, usuarioId: yo.id, informe: r })`. Si tira: `console.error` y devolver `{ error: { status: 503, message: "No se pudo registrar la simulación. Probá guardar de nuevo en un momento." } }`, sin guardar nada. Si anda: poner `r.simulacionId` y `r.empresaId`.
4. Guardar el JSON como hoy. Si falla y hubo simulación: `anular(id)` y devolver el error 500 de hoy.
5. Sin `yo.empresaId`: exactamente como hoy.

- [ ] **Step 1: Sumar `cookieDe`, `appConPostgres` e `INFORME_PRUEBA` a `test/helpers-pg.mjs`**

- [ ] **Step 2: Escribir las pruebas que fallan** en `test/informes-pg.test.mjs`

Todo dentro de `describe("informes con Postgres", { skip: omitirPg }, …)`. En `before`: `appConPostgres()`, empresa `A` con un estudiante (id `uEst`, cookie `cEst`) y un usuario de rol empresa (cookie `cEmp`). `cuantas()` cuenta las filas de `simulaciones`; `archivos()` lista `app.dataDir/informes`.

```js
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
```

- [ ] **Step 3: Verificar que fallan**

Run: `PG=… node --test test/informes-pg.test.mjs`
Expected: FAIL (no hay filas en `simulaciones`; el informe se guarda con el `simulacionId` falso).

- [ ] **Step 4: Implementar** `crear` en el service y `await` en el controller.

- [ ] **Step 5: Verificar que pasan y que no se rompió nada**

Run: `PG=… node --test test/informes-pg.test.mjs` → PASS.
Run: `node --test test/api.test.mjs test/auth-rutas.test.mjs test/evaluation.test.mjs` → igual que en la base de comparación.

- [ ] **Step 6: Sumar la prueba a `package.json` y commit**

```bash
git add backend/src/modules/simulaciones/services/informes.service.js \
  backend/src/modules/simulaciones/controllers/informes.controller.js \
  test/helpers-pg.mjs test/informes-pg.test.mjs package.json
git commit -m "feat(simulaciones): al guardar un informe se registra la simulación"
```

---

### Task 4: Service del inicio (lógica pura)

**Files:**
- Create: `backend/src/modules/empresa/inicio.service.js`
- Create: `test/inicio.test.mjs`
- Modify: `package.json` (sumar `test/inicio.test.mjs` a `test` y a `test:todo`)

**Interfaces:**
- Produces: `crearInicio({ contarJuniors, resumenSimulaciones, informesRecientes }) → { obtener }`
  - `obtener(yo, diasCrudo) → Promise<{ datos } | { error: { status, message, type? } }>`; `diasCrudo` es lo que devuelve `url.searchParams.get("dias")` (`string` o `null`)
  - Fuentes que recibe: `contarJuniors(empresaId) → Promise<number>`; `resumenSimulaciones(empresaId, dias) → Promise<{ total, enPeriodo, gastoTotal, gastoEnPeriodo }>`; `informesRecientes(empresaId, limite) → Array | Promise<Array>`
- El archivo no importa nada del proyecto (ni base, ni archivos, ni `config/`).

Reglas, en este orden:

1. Sin `yo.empresaId` → `{ error: { status: 409, type: "sin_empresa", message: "El inicio todavía no está disponible para esta cuenta: hace falta una cuenta de empresa que entre con Google." } }`.
2. `diasCrudo` `null` → 30. Si no es exactamente `"7"`, `"15"` o `"30"` → `{ error: { status: 400, message: "El período tiene que ser de 7, 15 o 30 días." } }`.
3. Pedir las tres fuentes (limite `4`). Si alguna tira → `console.error` y `{ error: { status: 503, message: "No se pudieron leer los datos del inicio. Probá de nuevo en un momento." } }`.
4. `datos` con la forma exacta del spec; los dos montos redondeados a 2 decimales; `informesRecientes` nunca con más de 4.

- [ ] **Step 1: Escribir las pruebas que fallan** en `test/inicio.test.mjs`

`falsas(extra)` vacía `llamadas` y devuelve las tres fuentes de mentira (pisadas por lo que venga en `extra`), que anotan sus argumentos en `llamadas` y devuelven `4`, `{ total: 57, enPeriodo: 12, gastoTotal: 142.5, gastoEnPeriodo: 30 }` y `[R1]`. `EMPRESA = { id: "u1", rol: "empresa", empresaId: "emp-1" }`.

```js
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

test("si una fuente falla: 503", async () => {
  for (const cual of ["contarJuniors", "resumenSimulaciones", "informesRecientes"]) {
    const r = await crearInicio(falsas({ [cual]: async () => { throw new Error("se cayó la base"); } })).obtener(EMPRESA, null);
    assert.equal(r.error.status, 503, cual);
  }
});

test("montos a dos decimales y nunca más de 4 informes", async () => {
  const r = await crearInicio(falsas({
    resumenSimulaciones: async () => ({ total: 3, enPeriodo: 3, gastoTotal: 7.499999999, gastoEnPeriodo: 0.30000000000000004 }),
    informesRecientes: () => [1, 2, 3, 4, 5, 6]
  })).obtener(EMPRESA, null);
  assert.deepEqual([r.datos.gasto.total, r.datos.gasto.enPeriodo, r.datos.informesRecientes.length], [7.5, 0.3, 4]);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `node --test test/inicio.test.mjs`
Expected: FAIL con "Cannot find module … inicio.service.js".

- [ ] **Step 3: Implementar** `crearInicio` en `backend/src/modules/empresa/inicio.service.js`.

- [ ] **Step 4: Verificar que pasan**

Run: `node --test test/inicio.test.mjs` → PASS.

- [ ] **Step 5: Sumar la prueba a `package.json` y commit**

```bash
git add backend/src/modules/empresa/inicio.service.js test/inicio.test.mjs package.json
git commit -m "feat(empresa): lógica del inicio (juniors, simulaciones, gasto e informes recientes)"
```

---

### Task 5: El pedido `GET /api/empresa/inicio`

**Files:**
- Modify: `backend/src/modules/auth/usuarios-pg.repository.js`
- Modify: `backend/src/modules/simulaciones/services/informes.service.js`
- Create: `backend/src/modules/empresa/inicio.controller.js`
- Create: `backend/src/modules/empresa/inicio.routes.js`
- Modify: `backend/src/routes.js`
- Modify: `test/inicio.test.mjs`

**Interfaces:**
- Consumes: `crearInicio` (Task 4); `resumen` de `simulaciones.service.js` (Task 2); `repoPg` de `backend/src/modules/auth/sesion.js` (es `null` sin Postgres); helpers de las tareas 2 y 3.
- Produces:
  - `usuarios-pg.repository.contarActivosPorRol(empresaId, rol) → Promise<number>`: usuarios con esa `empresa_id`, ese `rol` y `activo`
  - `informes.service.recientes(empresaId, limite) → Array<{ id, candidato, escenario, empresa, fecha, puntaje }>`: informes guardados con `empresaId` igual, del más nuevo al más viejo por `fecha`, con la misma forma que los elementos de `listar` (sacar ese mapeo a una función compartida por las dos). Ignora lo que no sea un informe legible.
  - `inicio.controller`: `crearControlador(inicio) → { obtener(req, res, { url, yo }) }`. Primero `exigir(res, yo, ["empresa"])`; después `inicio.obtener(yo, url.searchParams.get("dias"))`; error → `fail(res, status, message, type)`; si no → `json(res, 200, datos)`.
  - `inicio.routes`: `fuentes => [{ method: "GET", path: "/api/empresa/inicio", handler }]`
  - `routes.js`: arma el inicio con `contarJuniors: id => repoPg.contarActivosPorRol(id, "junior")`, `resumenSimulaciones: simulaciones.service.resumen`, `informesRecientes: informes.service.recientes`, y suma sus rutas a `privadas`. `repoPg` solo se usa dentro de esa función: con `yo.empresaId` siempre existe.

- [ ] **Step 1: Escribir las pruebas que fallan**, agregadas a `test/inicio.test.mjs`

Una que corre siempre, con `startApp()` común (sin base):

```js
test("sin Postgres: la empresa con contraseña recibe 409 y el resto de los roles 403", async () => {
  const r = await pedir(app.base, "/api/empresa/inicio");                       // cookie de empresa1
  assert.deepEqual([r.status, r.cuerpo.error.type], [409, "sin_empresa"]);
  assert.equal((await pedir(app.base, "/api/empresa/inicio", { cookie: await app.ingresar("estudiante1") })).status, 403);
  assert.equal((await pedir(app.base, "/api/empresa/inicio", { cookie: null })).status, 401);
});
```

Y `describe("inicio con Postgres", { skip: omitirPg }, …)`. En `before`: `appConPostgres()`; empresa `A` con un usuario empresa (`cEmpA`), un estudiante "Lucía Paz" (`cEstA`), dos juniors activos (la cookie de uno es `cJuniorA`) y uno inactivo; empresa `B` con usuario empresa (`cEmpB`), un estudiante (`cEstB`) y un junior; empresa `C` con usuario empresa (`cEmpC`) y un estudiante (`uEstC`). `inicio(cookie, q = "")` hace el `GET` y devuelve la respuesta.

```js
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
    empresa: "MKT Contact Center", fecha: INFORME_PRUEBA.fecha, puntaje: 78 }]);
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
```

- [ ] **Step 2: Verificar que fallan**

Run: `PG=… node --test test/inicio.test.mjs`
Expected: las pruebas de la Task 4 pasan; las nuevas fallan con 404 "Ruta no encontrada".

- [ ] **Step 3: Implementar** `contarActivosPorRol`, `recientes`, el controller, las rutas y el cableado en `routes.js`.

- [ ] **Step 4: Verificar que pasan**

Run: `PG=… node --test test/inicio.test.mjs` → PASS.
Run: `node --test test/inicio.test.mjs` → pasan las puras y "sin Postgres…"; el bloque con base figura como salteado.

- [ ] **Step 5: Verificar la regla de módulos**

```bash
grep -rn "modules/" backend/src/shared                                  # sin resultados
grep -rnE "require\(.*\.\./(auth|simulaciones|ia|mentor)/" backend/src/modules/empresa    # sin resultados
grep -rnE "require\(.*\.\./\.\./(auth|empresa|ia|mentor)/" backend/src/modules/simulaciones # sin resultados
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/auth/usuarios-pg.repository.js \
  backend/src/modules/simulaciones/services/informes.service.js \
  backend/src/modules/empresa/inicio.controller.js backend/src/modules/empresa/inicio.routes.js \
  backend/src/routes.js test/inicio.test.mjs
git commit -m "feat(empresa): GET /api/empresa/inicio"
```

---

### Task 6: Verificación completa y documentación

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Correr todo**

Run: `npm test` y `PG=… npm test`.
Expected: las mismas fallas que en la base de comparación de la Task 1 y ninguna más; con base, cero pruebas salteadas en `simulaciones`, `informes-pg` e `inicio`.

- [ ] **Step 2: Comprobar que el servidor arranca sin base**

Run: `npm run demo` (puerto 3200), `curl -s localhost:3200/health` → `{"ok":true}`, y cortar el proceso.

- [ ] **Step 3: Actualizar `CLAUDE.md`**

En **Arquitectura**, antes de "**Proveedores de IA.**", dos párrafos nuevos:

- **Postgres (opcional al arrancar):** `shared/db.js` abre el pool con `DATABASE_URL` y sin esa variable el servidor arranca igual; migraciones en `db/migrations/` (`npm run db:migrar`); hoy viven en Postgres las cuentas que entran con Google (su sesión trae `empresaId`) y el registro de simulaciones; la configuración, los informes y las cuentas con contraseña siguen en JSON; para las pruebas de la base, `docker compose up -d` y `TEST_DATABASE_URL` (sin eso se saltean).
- **Inicio de la empresa (`GET /api/empresa/inicio?dias=7|15|30`):** qué devuelve; que solo responde a rol `empresa` con cuenta en Postgres (409 `sin_empresa` si no); que la simulación se registra en `POST /api/informes` con `precio_usd` congelado y que borrar el informe no la borra; que el precio es `PRECIO_SIMULACION_USD` en `simulaciones.service.js`, siempre leído por `precioVigenteUsd()` porque a futuro sale de la base; y que las fuentes se juntan en `routes.js`. Con el link al spec.

En **Bitácora**, una entrada nueva arriba de todo: `### 2026-11-13 · Inicio de la empresa: simulaciones y gasto en Postgres (rama feat/perfil-empresa)`, con Para qué, Qué hay, Decisiones (las del spec), Límites (cuentas con contraseña, AWS sin base, doble guardado) y Estado (los números reales del Step 1).

- [ ] **Step 4: Commit, sin arrastrar los cambios ajenos de `CLAUDE.md`**

`CLAUDE.md` tiene cambios de infraestructura sin commitear que no son de esta rama. Si `git diff --quiet HEAD -- CLAUDE.md` daba 0 antes del Step 3, alcanza con `git add CLAUDE.md`. Si no, commitear solo lo nuevo:

```bash
git show HEAD:CLAUDE.md > "$TMP/CLAUDE.md"        # la versión commiteada, sin los cambios ajenos
# aplicar en "$TMP/CLAUDE.md" las mismas inserciones del Step 3
git update-index --cacheinfo 100644,$(git hash-object -w "$TMP/CLAUDE.md"),CLAUDE.md
git commit -m "docs: inicio de la empresa en CLAUDE.md"
git status -sb                                     # CLAUDE.md sigue " M": lo ajeno queda sin commitear
```

`$TMP` es la carpeta temporal de la sesión, fuera del repo.
