# Home del perfil Empresa (backend) — diseño

Fecha: 2026-11-13 · Rama: `feat/perfil-empresa` (sale de `master` en `03eb51d`) · Aprobado por Francisco el 2026-11-13

## Por qué

La empresa que contrata Tutoring no tiene hoy una pantalla de inicio: entra directo a la lista de informes. Quien la mira (el CEO, Recursos Humanos o quien lleva onboarding y capacitación) necesita ver de un vistazo cuánta gente tiene en capacitación, cuántas simulaciones se hicieron, cuánto lleva gastado y los últimos informes.

Es una sección **solo para mirar**: no se decide ni se edita nada desde ahí.

Este documento cubre **solo el backend**: el pedido que devuelve esos números ya calculados. El frontend se diseña después.

Es el primero de dos trabajos sobre el perfil Empresa. El segundo (criterios de evaluación por simulación en vez de por empresa) tiene su propio diseño.

## Objetivos

- Un pedido `GET /api/empresa/inicio` que devuelve, para la empresa de quien pregunta:
  - juniors en capacitación,
  - simulaciones realizadas (total histórico y en los últimos 7, 15 o 30 días),
  - gasto en simulaciones (total histórico y en ese mismo período),
  - los 4 informes más recientes.
- Cada simulación queda registrada en Postgres con **el precio vigente al momento de hacerla**. Cambiar el precio después no cambia lo que costaron las anteriores.
- Dejar la fila de `simulaciones` tal como la va a necesitar la migración de informes a Postgres, para que ese trabajo la complete en vez de rehacerla.

## No objetivos

- **No** hay frontend en este trabajo.
- **No** se migran a Postgres los informes, la configuración de la empresa ni las cuentas con contraseña. Siguen en JSON.
- **No** hay otras métricas (puntaje promedio, por criterio, por escenario, por persona, duración). Se descartaron a propósito.
- **No** hay descuentos, simulaciones gratis ni precio por empresa. Es una idea a futuro; el precio guardado por simulación ya lo permite sin cambiar el esquema.
- **No** se registra el costo en tokens (eso es `consumo_ia`, otra cosa: lo que nos cuesta a nosotros).
- **No** se registran las llamadas que no llegan a informe.
- **No** hay respaldo en JSON para el home: sin Postgres, el home no está disponible.
- **No** hay panel de administración ni precio editable mientras el servidor corre. Queda preparado (ver "Precio").
- **No** se toca la infraestructura en este diseño. Que esto llegue a AWS necesita Postgres ahí, y eso tiene su propio diseño, que es el trabajo siguiente.

## Anti-objetivos (sería un fracaso aunque ande)

- Que el gasto se calcule como "cantidad × precio de hoy". Tiene que salir de lo guardado en cada simulación.
- Que borrar un informe baje el gasto o el conteo de simulaciones.
- Que el navegador pueda decidir el precio, la empresa o la simulación a la que pertenece un informe.
- Que una empresa vea números o informes de otra.
- Que un módulo importe de otro módulo, o que `shared/` importe de `modules/` (regla del diseño del backend por capas).
- Que cambie el comportamiento de lo que hoy anda sin Postgres: `npm start`, `npm test` y `npm run demo` sin base tienen que seguir igual.

## Restricciones

- Node ≥ 22, CommonJS, `http` nativo, sin dependencias nuevas (`pg` ya está).
- Postgres es opcional al arrancar: el servidor levanta sin `DATABASE_URL`.
- Las cuentas viven en dos lugares durante la transición: las que entran con Google están en Postgres y su sesión trae `empresaId`; las de contraseña están en `usuarios.json` y no tienen empresa. Todas van a terminar en Postgres; **no** se construyen caminos alternativos para las de contraseña.
- La tabla `simulaciones` (migración 0003) exige `empresa_id` y `usuario_id` de Postgres.
- El informe lo arma el navegador y lo manda por `POST /api/informes`; el servidor lo guarda como un archivo JSON.
- El trabajo de Lau sobre informes (filtros, exportación, audio) no está subido y toca `informes.service.js` e `informes.repository.js`. Acá hay que tocar lo mínimo de esos archivos.

## Enfoques considerados

Lo que decide el diseño es dónde queda anotada cada simulación con su precio.

- **A. Registro aparte en JSON** (`data/simulaciones.json`), con la forma de la tabla de Facu. No depende de nadie y anda sin base, pero se pierde en cada deploy de AWS y hay que migrarlo después.
- **B. Escribir ya en la tabla `simulaciones` de Postgres.** Queda donde tiene que quedar y el gasto es una suma en SQL. Pero solo se pueden registrar simulaciones de cuentas que ya están en Postgres, y el home necesita la base.
- **C. Precio dentro del informe JSON y borrado que no borra.** Menos piezas, pero cambia qué significa borrar un informe, choca con el trabajo de Lau y no calza con el esquema, donde simulación e informe van separados.

**Elegido: B**, por Francisco, en su versión mínima: se escribe la fila de `simulaciones` y nada más de la migración. El resto de la migración se decide aparte. Se aceptan los límites de la sección "Límites conocidos".

## Diseño

### El pedido

`GET /api/empresa/inicio?dias=30`

- `dias` puede ser `7`, `15` o `30`. Si no viene, vale `30`. Cualquier otro valor: 400.
- Solo rol `empresa`.

Respuesta 200:

```json
{
  "dias": 30,
  "juniorsEnCapacitacion": 4,
  "simulaciones": { "total": 57, "enPeriodo": 12 },
  "gasto": { "moneda": "USD", "total": 142.5, "enPeriodo": 30 },
  "informesRecientes": [
    { "id": "…", "candidato": "María Gómez", "escenario": "Reclamo por doble cobro",
      "empresa": "MKT Contact Center", "fecha": "2026-11-12T18:03:11.000Z", "puntaje": 78 }
  ]
}
```

Qué significa cada dato, siempre para la empresa de quien pregunta (`empresaId` de su sesión):

| Dato | De dónde sale |
|---|---|
| `juniorsEnCapacitacion` | Cantidad de usuarios de Postgres con esa `empresa_id`, `rol = 'junior'` y `activo`. |
| `simulaciones.total` | Cantidad de filas de `simulaciones` de esa empresa. |
| `simulaciones.enPeriodo` | Las mismas, con `realizada_en` dentro de los últimos `dias` días. |
| `gasto.total` | Suma de `precio_usd` de esas filas. |
| `gasto.enPeriodo` | La misma suma, dentro del período. |
| `gasto.moneda` | Siempre `"USD"`. |
| `informesRecientes` | Hasta 4 informes guardados cuyo `empresaId` es el de esa empresa, del más nuevo al más viejo por `fecha`. Cada uno con los mismos campos que los elementos de `GET /api/informes`. |

- "Últimos N días" es una ventana corrida: desde ahora hacia atrás N × 24 horas, con el reloj de la base. No son días de calendario.
- Los montos viajan como números JSON con hasta dos decimales.
- Una empresa sin simulaciones recibe ceros y una lista vacía, no un error.
- Un informe borrado deja de aparecer en `informesRecientes`, pero su simulación sigue contando en `simulaciones` y en `gasto`.

### Errores

| Caso | Respuesta |
|---|---|
| Sin sesión | 401, como el resto de la API |
| Rol que no es `empresa` | 403 |
| `dias` inválido | 400, con un mensaje que diga los valores posibles |
| Sesión sin `empresaId` (cuenta con contraseña o script local con llave) | 409 con `type: "sin_empresa"` y un mensaje que explique que el inicio necesita una cuenta de empresa que entre con Google |
| La base no responde | 503 |

### Cuándo se registra una simulación

En `POST /api/informes`, que es el único momento en que el servidor se entera de que una simulación terminó. En orden:

1. Las validaciones de hoy (candidato, evaluación).
2. El servidor **descarta** `simulacionId` y `empresaId` si vienen en el cuerpo. Esos dos campos los pone solo el servidor. El precio no se guarda en el informe: vive únicamente en la fila de `simulaciones` y sale siempre de la constante, nunca del pedido.
3. Si quien guarda tiene `empresaId` en su sesión:
   1. Inserta una fila en `simulaciones`: `empresa_id` y `usuario_id` de la sesión, `escenario_id` en `NULL` (los escenarios todavía no están en Postgres), las copias del escenario (`titulo`, `resumen`, `cliente`, `objetivo`) tomadas del informe, `duracion_seg` del informe y `precio_usd` con el precio vigente. `realizada_en` la pone la base.
   2. Si ese `INSERT` falla, responde 503 y **no** guarda el informe. El navegador ya ofrece reintentar el guardado sin volver a evaluar.
   3. Guarda el informe JSON como hoy, con dos campos más: `simulacionId` (el id de la fila) y `empresaId`.
   4. Si el guardado del JSON falla, borra la fila recién insertada (mejor esfuerzo) y responde el 500 de hoy.
4. Si quien guarda **no** tiene `empresaId` (cuenta con contraseña o script local): guarda el informe exactamente como hoy y no registra ninguna simulación.

Se registra y se cobra la simulación de cualquier rol (candidato, junior o alguien de la empresa que la prueba).

Saneado de lo que viene del navegador antes de insertarlo: `duracion_seg` es un entero mayor o igual a cero; `escenario_titulo` no puede quedar vacío (la columna es `NOT NULL`), así que si falta se guarda un texto fijo como "Sin título".

### Precio

- Hoy es una constante, `PRECIO_SIMULACION_USD = 2.5`, marcada como **provisoria**. Es un solo precio para todas las empresas.
- No tiene archivo propio: vive en el service de simulaciones, que es el único que la usa.
- **Nadie lee la constante directo.** Todo el código le pide el precio a una sola función asíncrona (por ejemplo `precioVigenteUsd()`), que hoy devuelve la constante.
- Cambiar el precio hoy es editar la constante y desplegar. Vale para las simulaciones que se hagan desde ese momento; las anteriores conservan el suyo.
- No va en `.env` ni en `shared/utils/precios.js`: ese archivo son los precios de los modelos de IA (lo que nos cuesta a nosotros). Son dos cosas distintas y no tienen que confundirse.

**A futuro (no se construye ahora):** el precio lo vamos a editar nosotros desde un panel de administración. El cambio va a valer para todas las empresas y tiene que tomar efecto **mientras el servidor corre, sin redesplegar**. Cuando llegue ese panel:

- El precio pasa a guardarse en la base, con historial (valor, desde cuándo vale y quién lo cambió).
- `precioVigenteUsd()` pasa a leerlo de ahí. Tiene que salir de la base y no de una variable en memoria, porque puede haber más de una copia del servidor corriendo.
- El resto del código no cambia: por eso la función es asíncrona desde hoy y por eso nadie lee la constante directo.

### Base de datos

Migración nueva `db/migrations/0005_precio_de_simulacion.sql`, con el mismo formato que las anteriores (`-- Up Migration`, comentarios en español):

```sql
ALTER TABLE simulaciones
  ADD COLUMN precio_usd numeric(10, 2) NOT NULL CHECK (precio_usd >= 0);
```

- Es una **copia congelada**, igual que el escenario: lo que se le cobra a la empresa por esa simulación, al precio de ese día.
- **Sin `DEFAULT` a propósito**: quien inserte tiene que decir el precio. Un default de 0 regalaría simulaciones sin que nadie se entere.
- La tabla está vacía en todos los ambientes (hoy nadie escribe en ella), así que `NOT NULL` sin default no rompe nada.
- El índice `simulaciones_empresa_fecha_idx (empresa_id, realizada_en DESC)` que ya existe alcanza para las consultas del home.

### Escala: por qué se cuenta y no se guarda un total

`simulaciones.total` y `gasto.total` se calculan contando y sumando las filas de la empresa en cada pedido. No se guarda un total aparte.

- **Contar no cuelga la base.** La consulta va por el índice de la empresa, así que solo toca las filas de esa empresa, y es una lectura: no frena a quien está guardando simulaciones. Con un millón de filas de una sola empresa tardaría entre décimas de segundo y alrededor de un segundo (estimado, sin medir).
- **El volumen real está muy lejos de eso.** Un millón de simulaciones de una empresa son USD 2,5 millones facturados a ese cliente.
- **Un total guardado tiene costos:** pasa a haber dos fuentes para el mismo número y se pueden desfasar (y es plata); cada simulación nueva tendría que actualizar la misma fila de la empresa, y todas harían cola ahí; y no sirve para el filtro de 7, 15 y 30 días, que necesita las fechas igual.

Si algún día la consulta se vuelve lenta, en este orden: (1) sumar `precio_usd` al índice, para que contar y sumar lean solo el índice (una migración de una línea, sin lógica nueva); (2) una tabla de totales por empresa y por mes.

### Dónde vive el código

La regla del backend es que los módulos no se importan entre sí. El home necesita datos de tres lados: usuarios (`auth`), simulaciones e informes (`simulaciones`). Cada módulo expone su parte y se juntan en `backend/src/routes.js`, que ya es el lugar donde se arman los módulos.

Estructura sugerida (quien construye puede ajustarla mientras respete la regla):

| Archivo | Qué hace |
|---|---|
| `backend/src/modules/auth/usuarios-pg.repository.js` | Suma una función que cuenta usuarios activos de una empresa por rol. |
| `backend/src/modules/simulaciones/repositories/simulaciones-pg.repository.js` (nuevo) | Insertar una simulación, borrarla (para el paso 3.4) y el resumen de una empresa para un período (los cuatro números en una sola consulta). |
| `backend/src/modules/simulaciones/services/simulaciones.service.js` (nuevo) | El precio (constante y `precioVigenteUsd()`), registrar una simulación con su precio y el resumen de una empresa. |
| `backend/src/modules/simulaciones/services/informes.service.js` | `crear` pasa a ser asíncrona y sigue los pasos de arriba llamando al service de simulaciones. Suma una función que devuelve los informes recientes de una empresa. Se toca lo mínimo. |
| `backend/src/modules/simulaciones/controllers/informes.controller.js` | Espera a `crear`. |
| `backend/src/modules/empresa/` (archivos nuevos del inicio: rutas, controller, service) | Valida `dias` y la sesión, junta las tres fuentes y arma la respuesta. Recibe las tres funciones desde `routes.js`, no las importa. |
| `backend/src/routes.js` | Le pasa al inicio las funciones de `auth` y `simulaciones`. |

El service del inicio no sabe de Postgres ni de archivos: recibe funciones. Eso permite probar su lógica sin base.

## Límites conocidos (por la transición)

- **Cuentas con contraseña:** sus simulaciones no se registran ni se cobran, y una cuenta de empresa con contraseña (por ejemplo `empresa-demo`) recibe 409 en el home. Se resuelve solo cuando esas cuentas pasen a Postgres.
- **AWS:** hoy no hay Postgres en el ambiente de desarrollo, así que ahí el home responde 409 para todos. Francisco pidió que estos cambios lleguen a AWS: se resuelve en el diseño de "Postgres en AWS", que sigue a este.
- **Informes anteriores a este cambio:** no tienen simulación registrada y no cuentan. Son datos de prueba.
- **Doble guardado:** si el servidor guardó el informe pero la respuesta se perdió, el reintento del navegador crea otro informe y otra simulación, o sea un cobro doble. Ya pasa hoy con los informes duplicados. No se resuelve acá; queda anotado para la migración de informes.
- **`GET /api/informes`** sigue mostrándole al rol empresa todos los informes del servidor, sin filtrar por empresa. El home sí filtra. Se empareja en la migración de informes.
- **Probarlo a mano** necesita entrar con Google en la compu (`GOOGLE_CLIENT_ID`, `JWT_SECRET` y `DATABASE_URL` en el `.env`). Las pruebas automáticas no: usan claves de Google de prueba, como `test/login-google.test.mjs`.
- **Se puede inflar el gasto:** cualquier cuenta de Postgres puede sumar simulaciones y gasto mandando `POST /api/informes` sin haber hecho una llamada, porque el servidor no ve la llamada ni la evaluación. No hay tope. Está pendiente de decisión: un tope por usuario, exigir duración y turnos, o pasar la evaluación al servidor. Mientras tanto, el gasto no sirve como base de facturación. (encontrado en la revisión final, 2026-11-15)
- **Simulación cobrada sin informe:** si el proceso muere entre registrar la simulación y guardar el informe, o si el `INSERT` se confirma pero su respuesta se pierde, queda una fila sin informe. Se cierra cuando informes y simulaciones se guarden en la misma transacción (migración de informes a Postgres). (encontrado en la revisión final, 2026-11-15)

## Pruebas

Con Postgres (se saltean sin `TEST_DATABASE_URL`, mismo patrón que `test/login-google.test.mjs`: esquema al azar por corrida, migrar, borrar al final):

- Empresa sin actividad: ceros y lista vacía.
- Una cuenta de Postgres guarda un informe: aparece una fila en `simulaciones` con `precio_usd = 2.50`, el informe guardado trae `simulacionId` y `empresaId`, y el home muestra 1 simulación, 2.5 de gasto y ese informe en recientes.
- Borrar ese informe: simulaciones y gasto no cambian; recientes queda vacío.
- Período: filas con `realizada_en` de hace 3, 10, 20 y 40 días dan los conteos y sumas correctos con `dias` 7, 15 y 30.
- Precio congelado: filas con precios distintos entre sí dan la suma de lo guardado, no cantidad × precio actual.
- Juniors: no cuenta juniors inactivos, ni de otra empresa, ni otros roles.
- Aislamiento: simulaciones e informes de la empresa B no aparecen en el home de la empresa A.
- Recientes: con más de 4 informes devuelve los 4 más nuevos, en orden.
- El navegador no puede falsificar: un informe mandado con `empresaId` o `simulacionId` en el cuerpo se guarda sin esos valores (cuenta con contraseña) o con los del servidor (cuenta de Postgres), y la fila de `simulaciones` lleva el precio de la constante aunque el cuerpo traiga otro.
- Permisos y errores: 401 sin sesión, 403 para estudiante y junior, 409 `sin_empresa` para una cuenta con contraseña, 400 con `dias=5`.
- Migraciones: `test/db.test.mjs` pasa a esperar 5; insertar en `simulaciones` sin `precio_usd` falla.

Sin Postgres (corren siempre):

- La lógica del service del inicio con funciones falsas: validación de `dias`, valor por defecto, armado de la respuesta, error si falta `empresaId`.
- `POST /api/informes` con cuentas de contraseña se comporta igual que hoy (los tests actuales tienen que pasar sin cambios).
- Si registrar la simulación falla, el informe no se guarda; si guardar el informe falla, la simulación se borra. Se puede probar con funciones falsas o forzando el error en el esquema de prueba; lo elige quien construye.

El archivo nuevo de pruebas se suma a `npm test` y a `npm run test:todo`.

## Decisiones de Claude (no las pidió Francisco; revisar)

1. La ruta es `/api/empresa/inicio` y el período por defecto es 30 días.
2. "Últimos N días" es una ventana corrida de N × 24 horas, no días de calendario.
3. Solo cuenta como simulación la que terminó con un informe guardado. Una llamada cortada antes no se registra ni se cobra.
4. Orden estricto: primero se registra la simulación y después se guarda el informe. Si la base está caída, una cuenta de Postgres no puede guardar su informe hasta que vuelva (el navegador deja reintentar). La alternativa era guardar el informe igual y perder el cobro.
5. Se cobra la simulación de cualquier rol, también si la hace alguien de la empresa para probar.
6. Una cuenta de empresa con contraseña recibe un error claro (409) en vez de ceros, para que no parezca que no hubo actividad.
7. Los informes anteriores a este cambio no se cuentan ni se les inventa un precio.
8. `precio_usd` no tiene valor por defecto en la base.
9. `informesRecientes` devuelve 4, fijo, con la misma forma que la lista de informes.
10. El home vive en el módulo `empresa` y recibe sus fuentes desde `routes.js`.
11. Los totales se cuentan en cada pedido; no se guarda un total por empresa (ver "Escala"). Francisco lo preguntó y lo aprobó.

## Qué queda para quien construye

- Nombres de funciones y de archivos dentro de la estructura sugerida.
- La consulta SQL del resumen (una sola, con `count` y `sum` filtrados por período) y pasar a número lo que Postgres devuelve como texto (`numeric`).
- Los textos exactos de los mensajes de error, en español rioplatense como el resto.
- Cómo arman las pruebas las cuentas de Postgres y sus sesiones (por el ingreso con Google de prueba o insertando usuarios y firmando el JWT), y si conviene sacar eso a `test/helpers.mjs`.
- Si deja una línea en el log cuando un informe se guarda sin registrar simulación.
- Los topes de saneado (`duracion_seg`, largo de los textos del escenario).
- Actualizar `CLAUDE.md` del repo: la sección de arquitectura (que hoy no menciona Postgres ni el ingreso con Google) y una entrada nueva arriba en la Bitácora.

## Entorno local

- Postgres: `docker compose up -d` (puerto 55432). En la compu de Francisco `docker compose` no puede leer el `.env` del repo (lo toma como archivo de variables y falla en la primera línea); anda con `docker compose --env-file /dev/null up -d` (comprobado). La base de Tutoring todavía no se levantó nunca en esa compu.
- Para correr las pruebas de la base alcanza con `TEST_DATABASE_URL` en el ambiente; no hace falta tocar el `.env`.

## Coordinación con el equipo

- **Facu:** esta rama toma el número de migración `0005`. Si él agrega otra en paralelo, hay que renumerar antes de mergear (`node-pg-migrate` corre con `checkOrder`).
- **Lau:** se tocan `informes.service.js` (función `crear`) e `informes.controller.js`. Cuando suba lo suyo va a haber que mezclar esos dos archivos a mano.
