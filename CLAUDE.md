# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

El proyecto, el código, los comentarios y los mensajes de la interfaz están en español rioplatense. Mantené ese idioma y ese tono, incluidos los mensajes de error que ve el usuario. `LEEME.md` es el README completo, con la configuración de proveedores, voz y caché.

## Comandos

```
npm start                       # servidor en http://localhost:3000 (PORT=3100 npm start para otro puerto)
npm test                        # servidor + lógica pura, sin navegador ni API real
npm run test:e2e                # navegador real con Playwright (se saltea si no está instalado)
node --test test/core.test.mjs  # un solo archivo
node --test --test-name-pattern="puntaje" test/core.test.mjs   # un solo test
npm run demo                    # app contra una IA falsa en :3200, datos en carpeta temporal
npm run probar-ia               # prueba real de los modelos del .env (gasta cuota)
npm run chequeo [-- --rapido]   # prueba real de todo lo que se usa en la demo
python evals/run_evals.py [casos...] -n 3 [--levantar-servidor]   # evals reales del evaluador (gasta cuota)
npm run usuarios -- crear --rol <estudiante|junior|empresa> --nombre "Nombre Apellido"   # imprime el código inicial
npm run usuarios -- listar | resetear <u> | desactivar <u> | activar <u>
npm run usuarios -- demo        # cuentas de prueba candidato-demo / junior-demo / empresa-demo, clave 1234 (ver GUIA-DEMO.md)
```

No hay build ni linter. El frontend es JS plano servido tal cual desde `public/`.

## Arquitectura

**Servidor (`backend/`, sin framework, capas por módulo).** `backend/server.js` arranca; `backend/src/routes.js` fija el orden de chequeos de la API (origen → chequeo local → ingreso → sesión → contraseña pendiente → rutas). Cada módulo de `backend/src/modules/` (`auth`, `ia`, `empresa`, `simulaciones`, `mentor`) tiene sus capas routes → controller → service → repository y no importa de otro módulo; lo común (cadena de IA, HTTP, voz, utilidades) está en `backend/src/shared/`, y `.env`/`DATA_DIR`/`public/` se resuelven desde la raíz del repo (`backend/src/config/`). Sirve `public/`, guarda la configuración y los informes como JSON en `data/` (o en `DATA_DIR`) y hace de proxy hacia los proveedores de IA por `POST /api/messages`. Las keys nunca salen del servidor. `sanitizePayload` decide qué campos del navegador pasan: el navegador manda `purpose` (`chat` | `voice` | `eval`) y es el servidor el que elige proveedor y modelo (`PROVIDERS[id].models[purpose]`). Las respuestas siempre se reemiten al navegador como SSE con el formato de eventos de Claude, sin importar el proveedor (`crearSSE`).

**Usuarios y sesiones (`backend/src/modules/auth/`).** Sin sesión no se puede usar nada: toda `/api/*` responde 401 (`type: "sin_ingreso"`), salvo `/api/login` y `/api/chequeo/*`. Los archivos estáticos se sirven igual. `auth.service.js` guarda todo en la carpeta de datos:
- `usuarios.json`: contraseñas con `scrypt` y sal.
- `sesiones.json`: la clave es `sha256(token)` y dura 12 horas.

El token viaja en la cookie `sesion` (`HttpOnly`, `SameSite=Lax`). Si el servidor arranca sin ningún usuario, crea las cuentas de prueba (`CUENTAS_DEMO` en `auth.service.js`: `candidato-demo`, `junior-demo` y `empresa-demo`, clave `1234`) y, mientras estén activas, lo avisa en la consola. Las cuentas reales se crean por consola (`scripts/usuarios.mjs`) con un código inicial `XXX-XXX-XXX` y `debeCambiar`. Hasta crear su contraseña, esa persona solo puede usar `/api/yo`, `/api/contrasena` y `/api/logout`.

Otras reglas del servidor:
- **Intentos de ingreso:** 5 fallos por usuario y 30 por IP en 60 segundos, después responde 429. En un aula todos salen por la misma IP.
- **Origen:** los POST, PUT y DELETE que llegan desde otro `Origin` se rechazan.
- **Permisos por rol** (`exigir`): solo `empresa` guarda la configuración, borra informes y usa `/api/diagnostico`. Cada estudiante o junior ve solo sus informes (`loVe`, por `usuarioId`) y el servidor pone `candidato` con el nombre de la sesión.
- **Llave local:** los scripts de la compu (`chequeo`, `probar-ia`, `evals/puente.mjs`) no tienen cookie. Mandan el contenido de `DATA_DIR/llave-local.txt` en el encabezado `x-llave-local` y entran con permisos de empresa.

**Postgres (opcional al arrancar).** `backend/src/shared/db.js` abre el pool con `DATABASE_URL`, y recién cuando alguien lo pide: sin esa variable el servidor arranca igual. Las migraciones están en `db/migrations/` (`npm run db:migrar`). Hoy viven en Postgres las cuentas que entran con Google (su sesión trae `empresaId`) y el registro de simulaciones (tabla `simulaciones`). La configuración de la empresa, los informes y las cuentas con contraseña siguen en JSON. Para las pruebas de la base: `docker compose up -d` (puerto 55432; si no puede leer el `.env`, `docker compose --env-file /dev/null up -d`) y `TEST_DATABASE_URL`. Sin esa variable esas pruebas se saltean.

**Inicio de la empresa (`GET /api/empresa/inicio?dias=7|15|30`, sin `dias` vale 30).** Devuelve `{ dias, juniorsEnCapacitacion, simulaciones: { total, enPeriodo }, gasto: { moneda: "USD", total, enPeriodo }, informesRecientes }`; los informes son hasta 4, con la forma de la lista de `GET /api/informes`. Responde solo al rol `empresa` y solo si su cuenta está en Postgres: una cuenta con contraseña o un script local recibe 409 `sin_empresa`; un `dias` inválido, 400; si una fuente falla, 503. Cada simulación se registra en `POST /api/informes`: si quien guarda tiene `empresaId`, primero se inserta la fila de `simulaciones` con `precio_usd` (el precio vigente, congelado) y después se guarda el informe JSON con `simulacionId` y `empresaId`, que pone solo el servidor (lo que mande el navegador en esos campos se descarta). Si no se puede registrar, responde 503 y no guarda el informe; si no se puede guardar el informe, anula la simulación. Borrar un informe no borra su simulación: sigue contando en simulaciones y en gasto. El precio es `PRECIO_SIMULACION_USD` (provisorio) en `simulaciones.service.js`, y nadie lo lee directo: se pide por `precioVigenteUsd()`, porque a futuro se va a editar desde un panel de administración y se va a leer de la base. No se confunde con `shared/utils/precios.js`, que son los precios de los modelos de IA (lo que nos cuestan a nosotros). Los módulos siguen sin importarse entre sí: `backend/src/routes.js` es el único lugar que junta las fuentes de `auth` y `simulaciones` y se las pasa a `empresa/inicio.service.js`. Diseño: `docs/superpowers/specs/2026-11-13-home-empresa-design.md`.

**Proveedores de IA.** Hay tres, configurados por `.env`:
- `claude-sdk`: el Claude Agent SDK (Claude Code con la suscripción de la máquina), usado solo como modelo de texto, sin herramientas y en un directorio vacío (`opcionesSdk`).
- `anthropic`: la API de Anthropic por `fetch` directo, no con `@anthropic-ai/sdk`.
- `gemini`: por su endpoint compatible con OpenAI.

`LEEME.md` dice que el proveedor por defecto es `gemini`, pero en el código es `claude-sdk` (`PRIMARY`). El flujo general es `responder()` → `conReintentos()` → `intentar()` → `RUN[id]`, con backoff y paso al proveedor de respaldo según el código de error (`esReintentable`, `pasaAlRespaldo`).

**La evaluación tiene un camino propio (`responderEval`).** Usa su propia cadena (`EVAL_CADENA`, configurable con `LLM_EVAL_CADENA`). Hace una "carrera" (`carreraEval`): si `claude-sdk` no termina en `EVAL_CARRERA_MS`, lanza un segundo intento en paralelo y gana el primer informe válido. El texto no se transmite a medida que llega: `intentar` lo acumula, lo valida con `core.parseEvaluacion` y lo entrega completo. Para Gemini fuerza el JSON con `EVAL_SCHEMA`; si cambiás los campos del informe, actualizá ese esquema, el prompt y el parseo a la vez.

**Código compartido entre navegador y Node.** `public/js/core.js` es UMD: el servidor y los tests lo importan con `require`, y el navegador lo expone en `window.T.core`. Contiene la lógica pura: historial, `extraerJSON`/`parseEvaluacion`, `puntajeCriterio`/`puntajePonderado` (puntaje de 0 a 100 a partir de criterios de 1 a 5; los criterios en `null` quedan fuera) y la migración de la configuración. `prompts.js` y `defaults.js` solo existen en el navegador (`window.T.prompts`, `T.DEFAULTS`). Cuando Node necesita esos archivos, los carga en un contexto `vm` (ver `evals/puente.mjs`).

**Frontend (`public/js/app.js`).** Es una SPA sin framework: `VIEWS[nombre]`, `go()` y el estado en `S`. Al arrancar, `boot()` → `entrar()` pide `/api/yo`; sin sesión muestra `VIEWS.login` (`body.sin-sesion` oculta la barra lateral). El perfil sale del rol de la sesión: ya no hay selector de perfil ni campo de nombre. Cada rol tiene su pantalla de inicio (`INICIO`) y su color (`body[data-rol]`). El `localStorage` se separa por usuario (`k()`). Un 401 `sin_ingreso` en cualquier pedido lleva al ingreso con aviso (`T.api.onSinSesion`). Hay tres perfiles: estudiante (se muestra como "Candidato": simulación por voz e informe), junior (chat con el mentor) y empresa (configura contexto, escenarios y criterios, y ve los informes). El informe se arma en el navegador (`runEvaluation`): prompt de `T.prompts.evaluacion`, `purpose: "eval"`, parseo y puntaje con `core`, y después `POST /api/informes`. El servidor lo guarda casi como llega: descarta `simulacionId` y `empresaId` si vienen del navegador y, para las cuentas de Postgres, los pone él (ver "Inicio de la empresa"). Candidato y empresa ven la misma vista (`VIEWS.report`).

**Quién arranca la llamada.** El campo `inicio` del escenario define quién habla primero: sin el campo, el cliente (como siempre); `"atiende"` (llamada entrante: `vozInicio` devuelve `null` y los tres motores esperan a que hable el candidato); `"llama"` (llamada saliente: el cliente atiende solo con "¿Hola?"). El prompt de voz y el de evaluación lo mencionan solo si el campo está, así los escenarios viejos no cambian.

**Voz (`public/js/voice.js`).** Tres motores con la misma interfaz: `gemini-live` (por defecto, voz a voz por WebSocket directo a Google con un token efímero de `/api/voz/token`), `vapi` y `browser`. La transcripción que generan es la que después se evalúa.

**Por qué Gemini Live no pasa por el backend.** El navegador abre el WebSocket directo a Google (el servidor solo mintea el token efímero: un uso, ~30 min, atado al modelo). Así el audio no hace el salto extra navegador → server → Google, que en voz a voz se nota en la latencia; la `GEMINI_API_KEY` no sale del servidor y el servidor no sostiene un WebSocket de audio por llamada. El costo: el backend no ve nada de la llamada. Si hace falta verlo, el navegador lo reporta (ver tokens abajo) o habría que hacer un proxy WebSocket en el backend (ve todo y da números exactos, pero suma latencia y carga; no se hizo).

**Tokens de la llamada de voz (Gemini Live).** `voice.js` suma el `usageMetadata` que Google manda una vez por turno (`promptTokenCount` ya incluye todo el contexto de ese turno; se asume que cada turno se cobra entero, sin verificar todavía contra la facturación de Google; las sesiones renovadas también cuentan) y, al colgar (`liberar()` → `informarUso()`), hace `POST /api/voz/uso` con `fetch` `keepalive`. `voz.service.registrarUso` escribe una línea `[VOZ] gemini-live · modelo · llamada · Ns · usuario=… · N turnos · tokens in=… (texto/audio) out=… (audio/texto) pensamiento=…` en la terminal y en `data/logs/ia-AAAA-MM-DD.log` (el mismo archivo del log de la IA). Límites: si cierran la pestaña de golpe el reporte puede perderse, y un navegador modificado podría mandar números falsos, así que sirve para ver consumo, no como facturación confiable. Los tokens de pensamiento se cobran como salida.

**Costos en el log.** `backend/src/shared/utils/precios.js` tiene los precios hardcodeados de Gemini Live y Claude (por millón de tokens) y calcula el costo: la línea `[VOZ]` suma `costo=US$…` y `logIA` agrega el costo a cada consulta a Claude, incluidos los intentos fallidos de la evaluación. Con `claude-sdk` figura como "costo equivalente por API", porque la suscripción no paga por token. Los modelos sin precio cargado (hoy, el Gemini de texto de respaldo) salen sin costo. `npm run costos [-- archivo.log] [-- --solo-resumen]` completa un log viejo (deja `.bak`) y muestra los totales. Supuestos: pensamiento a la tarifa de salida de texto, el alias `sonnet` = `claude-sonnet-5-5`, `haiku` = `claude-haiku-5-5` y caché de 5 minutos (escribir 1,25x, leer 0,1x). Si la key de Gemini está en el plan gratuito, la voz no se paga: el número es lo que costaría en el plan pago.

**Costo de una simulación completa.** Cuando están la llamada y su informe, el log suma una línea `[SIM] #pedido simulación · llamada US$… + informe US$… = total US$…`. El navegador genera un id por llamada (`S.simulacion` en `VIEWS.call`) y lo manda en `/api/voz/uso` y en la evaluación (`simulacion`, no llega al proveedor); `shared/utils/costo-simulacion.js` los une en memoria, en cualquier orden, y dos horas después descarta lo que quedó sin par. El informe suma todos sus intentos con tokens, incluidos los fallidos y los del Reintentar; un intento cancelado no informa tokens y no suma. Una llamada sin informe (muy corta) no tiene línea `[SIM]`, y tampoco los motores `vapi` y `browser`, que no informan tokens. `npm run costos` agrega `[SIM]` a logs viejos uniendo por hora (±5 s).

**Llamada por teléfono (`VIEWS.call` en `app.js`).** En los escenarios por teléfono con un cliente (no en persona ni con el líder) suena un timbre (`T.voice.tono`, generado con Web Audio) y el candidato toca **Atender**; mientras suena, la pantalla muestra solo ese botón, al centro (`.call.sonando`). Si `inicio` es `"atiende"`, el motor conecta mientras suena, con el micrófono silenciado, y el botón se habilita cuando la voz está lista. Si habla primero el cliente, el motor arranca al atender. En las salientes (`"llama"`) el candidato toca **Llamar** y suena el tono de llamada hasta que el cliente empieza a hablar. Con la voz telefónica, al conectarse suena un ruido de línea suave de fondo (`T.voice.linea`). Con Gemini Live, la voz del cliente pasa por un filtro telefónico (`telefono()` en `voice.js`) salvo que `cfg.vozTelefonica` sea `false`. El acento rioplatense lo sostiene la sección "TU ACENTO" de `prompts.js` y la renovación de la sesión de Gemini Live cada 2 minutos (`quizasRenovar` en `voice.js`, en un silencio y sin corte); describe el sonido sin escribir las palabras como suenan, porque si no la transcripción sale con "sho" (`core.textoHablable` corrige lo que se cuele). Antes de la llamada, el brief tiene una prueba de audio (`pruebaDeAudio` en `app.js`): micrófono, salida, nivel y sonido de prueba; lo elegido queda en `S.audio` y lo usa Gemini Live. Lo que la vista deja abierto se cierra en `render()` con `S.alSalirDeVista`.

**Caché de prompts.** El prompt del mentor está ordenado para que la parte estable vaya primero (`system_estable` indica hasta dónde). `test/prompts.test.mjs` compara contra `test/fixtures/prompts-antes.js` que el texto que recibe el modelo no cambie. Si modificás `prompts.js` a propósito, actualizá ese fixture.

## Tests

- Ningún test usa la API real. `test/helpers.mjs` (`startApp`) arranca `backend/server.js` en un proceso aparte, con `DATA_DIR` temporal y las URLs de los proveedores apuntando a `test/fake-llm.mjs`.
- El Agent SDK se reemplaza con `CLAUDE_SDK_MODULE` (por ejemplo, `test/fake-sdk-*.mjs`).
- `startApp` siembra usuarios (`estudiante1`, `estudiante2`, `junior1`, `empresa1`, con clave `clave-de-prueba`, y `nuevo1`, que entra con `app.codigoNuevo`) y entra como `empresa1`. `pedir()` y `pedirMensajes()` mandan esa cookie salvo `{ cookie: null }` u otra. En Playwright se usa `ingresarEn(page, base, usuario)` y `salirEn(page)`.
- Cuando agregues una variable de entorno que lea el servidor, neutralizala en `startApp` para que no se filtre el `.env` real.
- `test/helpers-pg.mjs` es el equivalente para las pruebas con Postgres: da `crearEsquema`, `crearEmpresa`, `crearUsuario`, `simHace` (una simulación de hace N días con un precio), `cookieDe` (cookie de sesión firmada), `appConPostgres` e `INFORME_PRUEBA`. Cada archivo de prueba usa un esquema propio al azar y lo borra al terminar. Esas pruebas necesitan `TEST_DATABASE_URL`; sin eso se saltean.

## Evals (`evals/`)

Hoy hay 5 casos sintéticos, todos del escenario `incidente-viernes` de Nodo, con rangos esperados que todavía no revisó RRHH. Para tener un golden set hacen falta entre 40 y 50 casos puntuados a mano por una licenciada en RRHH, la mayoría conversaciones reales de un piloto.

`evals/golden-mkt/` tiene 9 casos sintéticos de los escenarios de call center (empresa de ejemplo `mkt` en `defaults.js`, borrador en `docs/escenarios-mkt.md`) con `esperado: null`. El rango esperado lo decide RR. HH. con `planilla-rrhh.csv` (dos personas por caso), nunca quien escribió los casos ni la IA. `test/mkt.test.mjs` verifica que los casos coincidan con los escenarios.

`run_evals.py` corre las transcripciones de `evals/transcripciones/*.json` por el evaluador real. No reimplementa nada: delega en `puente.mjs`, que usa el mismo prompt, el mismo `system` y el mismo `max_tokens` que `app.js` (los lee del código fuente) y el `POST /api/messages` de un servidor levantado. Cada caso trae los rangos esperados por criterio en `esperado`. Los resultados van a `evals/resultados/<AAAAMMDD-HHMMSS>/` (`resumen.csv`, `criterios.csv`, `corridas.csv`, `crudo.jsonl`).

## Bitácora

Registro paso a paso de los cambios del programa: qué se decidió, por qué y dónde está el detalle. Se actualiza en cada paso, con el más nuevo arriba. Cuando algo se implementa, se describe también en la sección de arquitectura que corresponda.

### 2026-11-15 · Inicio de la empresa: simulaciones y gasto en Postgres (rama `feat/perfil-empresa`)

- **Para qué:** que quien mira la empresa (CEO, RR. HH. o quien lleva onboarding) vea de un vistazo cuánta gente tiene en capacitación, cuántas simulaciones se hicieron, cuánto lleva gastado y los últimos informes. Es solo para mirar. Este trabajo es solo backend: el frontend se diseña después.
- **Qué hay:**
  - `GET /api/empresa/inicio?dias=7|15|30`. Detalle en "Inicio de la empresa" de Arquitectura.
  - Migración `db/migrations/0005_precio_de_simulacion.sql`: columna `precio_usd numeric(10, 2) NOT NULL` en `simulaciones`, sin valor por defecto a propósito.
  - `simulaciones/repositories/simulaciones-pg.repository.js` (insertar, borrar y el resumen en una sola consulta), `simulaciones/services/simulaciones.service.js` (precio, saneado, registrar, anular, resumen), `informes.service.js` (`crear` ahora es asíncrona; `recientes`), `auth/usuarios-pg.repository.js` (`contarActivosPorRol`) y `empresa/inicio.{service,controller,routes}.js`.
  - Pruebas: `test/helpers-pg.mjs` (esquema de prueba al azar, empresas, usuarios, cookies firmadas), `test/simulaciones.test.mjs`, `test/informes-pg.test.mjs` y `test/inicio.test.mjs`. Las que usan la base se saltean sin `TEST_DATABASE_URL`.
  - `scripts/db.mjs` pasa `advisoryLockMode: "wait"` cuando recibe `schema` (solo las pruebas): los archivos de prueba migran en paralelo y antes fallaban a veces con "Another migration is already running". `npm run db:migrar` no cambió.
- **Decisiones:**
  - El gasto sale de lo guardado en cada simulación, no de cantidad por el precio de hoy: cambiar el precio no cambia lo que costaron las anteriores.
  - Los totales se cuentan en cada pedido; no se guarda un total por empresa. Si algún día la consulta se vuelve lenta: primero sumar `precio_usd` al índice y después una tabla de totales por mes.
  - "Últimos N días" es una ventana corrida de N × 24 horas con el reloj de la base, no días de calendario.
  - Primero se registra la simulación y después se guarda el informe. Si el registro falla (por ejemplo, con la migración 0005 sin aplicar), responde 503 y el navegador deja reintentar. Si la base está caída del todo, la sesión de una cuenta de Postgres no se puede verificar y cualquier pedido responde 401, así que el candidato vuelve al ingreso (eso es de `auth/sesion.js`, anterior a esta rama).
  - Se registra y se cobra la simulación de cualquier rol, también si la hace alguien de la empresa para probar. Una llamada que no llega a informe no cuenta.
  - Una cuenta de empresa con contraseña recibe un 409 claro en vez de ceros, para que no parezca que no hubo actividad.
  - El navegador no decide precio, empresa ni simulación del informe: el servidor descarta `simulacionId` y `empresaId` del cuerpo.
  - Sin respaldo en JSON: sin Postgres no hay inicio.
- **Límites conocidos:**
  - Las simulaciones de cuentas con contraseña no se registran ni se cobran hasta que esas cuentas pasen a Postgres.
  - En AWS todavía no hay Postgres, así que ahí el inicio responde 409 para todos. Se resuelve en el diseño de "Postgres en AWS".
  - Si el servidor guardó el informe pero la respuesta se perdió, el reintento del navegador crea otro informe y otra simulación (cobro doble). Queda anotado para la migración de informes.
  - Los informes anteriores a este cambio no tienen simulación registrada y no cuentan.
  - **Se puede inflar el gasto:** cualquier cuenta de Postgres puede sumar simulaciones y gasto mandando `POST /api/informes` sin haber hecho una llamada, porque el servidor no ve la llamada ni la evaluación. No hay tope. Está pendiente de decisión: un tope por usuario, exigir duración y turnos, o pasar la evaluación al servidor. Mientras tanto, el gasto no sirve como base de facturación.
  - **Simulación cobrada sin informe:** si el proceso muere entre registrar la simulación y guardar el informe, o si el `INSERT` se confirma pero su respuesta se pierde, queda una fila sin informe. Se cierra cuando informes y simulaciones se guarden en la misma transacción (migración de informes a Postgres).
  - **La fecha la manda el navegador:** "informes recientes" se ordena por `fecha`, que viene en el informe. Se resuelve con la fecha del servidor cuando los informes pasen a la base.
  - `GET /api/informes` sigue mostrándole al rol empresa todos los informes del servidor, sin filtrar por empresa, y `DELETE /api/informes/:id` tampoco filtra: una cuenta de rol empresa puede borrar un informe de otra. El inicio sí filtra.
  - Probarlo a mano necesita entrar con Google en la compu (`GOOGLE_CLIENT_ID`, `JWT_SECRET` y `DATABASE_URL` en el `.env`).
- **Para desplegar:** la migración 0005 se aplica (`npm run db:migrar`) antes de desplegar este código; si no, las cuentas de Postgres reciben 503 al guardar un informe.
- **Coordinación:** la migración toma el número `0005`; si Facu agrega otra en paralelo hay que renumerar antes de mergear. Lau toca `informes.service.js` (`crear`) e `informes.controller.js`: cuando suba lo suyo hay que mezclarlos a mano.
- **Estado:** `npm test` sin base pasa 196 de 202 (5 saltean y falla el de siempre, `estáticos: sirve la app y bloquea salir de /public`). Con `TEST_DATABASE_URL` pasa 235 de 236, con la misma falla y ninguna salteada. `npm run demo` arranca sin base (`/health` responde `{"ok":true}`). Diseño y plan: `docs/superpowers/specs/2026-11-13-home-empresa-design.md` y `docs/superpowers/plans/2026-11-13-home-empresa.md`.

### 2026-11-03 · Costo en dólares en el log (llamadas e informes)

- **Qué hay:** `precios.js` con los precios hardcodeados, costo en las líneas `[VOZ]` y en las de Claude, y `npm run costos` para completar logs viejos y sumar. Detalle en "Costos en el log" de Arquitectura.
- **Pruebas del 2026-11-03 (estimación, sin comparar con la factura):** 7 llamadas, 13 minutos, US$ 0,50 (US$ 0,07 por llamada, US$ 0,04 por minuto). 6 informes, US$ 0,34 equivalentes por API (US$ 0,06 por informe), que no se pagan porque van por la suscripción.
- **Abierto:** comparar el número de la voz con la facturación de Google. Sumar todo el contexto de cada turno da casi 3 veces más que estimar solo por minutos de audio.
- **Línea `[SIM]`:** el log muestra llamada + informe = total de cada simulación, unidos por un id que genera el navegador. Las 6 simulaciones con informe de ese día salieron entre US$ 0,07 y US$ 0,22.
- **Estado:** `test/precios.test.mjs`, nuevo. `LEEME.md` actualizado con los precios nuevos. `npm test` pasa 160 de 161 y `npm run test:e2e`, 37 de 38. Los dos que fallan (`estáticos: sirve la app y bloquea salir de /public` e `interrumpir al cliente lo corta y pasa a escuchar`) fallan igual sin estos cambios.

### 2026-11-03 · Log de tokens de la llamada de voz con Gemini Live

- **Para qué:** saber cuántos tokens de entrada y salida gasta una simulación por voz.
- **Qué hay:** el navegador suma el `usageMetadata` de Gemini Live y al colgar lo manda a `POST /api/voz/uso`; el servidor escribe una línea `[VOZ] gemini-live …` en la terminal y en `data/logs/ia-AAAA-MM-DD.log`. Detalle en la sección Voz de Arquitectura.
- **Probado con la API real:** Google manda el conteo una vez por turno y el input de cada turno incluye el contexto anterior, por eso `in` crece más rápido que la duración de la llamada.
- **Por qué lo reporta el navegador:** porque la voz va directo a Google (decisión de latencia y de seguridad de la key); el backend no ve la llamada.
- **Estado:** test nuevo en `test/api.test.mjs`; `npm test` pasa 153 de 154. El que falla (`estáticos: sirve la app y bloquea salir de /public`, espera 403 y recibe 404 para `/..%5c.env`) falla igual sin estos cambios. Falta probarlo en una llamada de voz real en el navegador.

### 2026-10-27 · Mientras suena, solo el botón verde y al centro (rama `feat/llamada-realista`)

- **Qué cambió:** mientras suena el teléfono (antes de Atender o Llamar), la pantalla muestra solo el círculo, a quién llamás o quién llama y el botón verde, centrados en el panel. Colgar, el micrófono, el teclado y la transcripción aparecen recién al atender (o al tocar Llamar, para poder cortar mientras suena el tono). Antes estaban todos a la vez y el bloque quedaba arriba, con un hueco abajo.
- **Cómo:** clase `.call.sonando` en `VIEWS.call` (se saca en `yaAtendio()`), y la vista de la llamada ocupa todo el alto del panel (`#view:has(> .call)`), que antes no lo hacía.
- **Estado:** `npm test` pasa 153 de 153 y `npm run test:e2e`, 38 de 38.

### 2026-10-27 · Pruebas reales: diálogo afectivo de Gemini Live y puntajes de los escenarios de MKT (sin cambios en el código)

- **Diálogo afectivo (`generationConfig.enableAffectiveDialog`):** `gemini-3.8-live` (el modelo de la app) y `gemini-3.1-flash-live-preview` aceptan el campo en el setup, pero cortan la sesión con `1007 Request contains an invalid argument` cuando tienen que responder, tanto en `v1beta` como en `v1alpha`. Solo `gemini-2.5-flash-native-audio-latest` lo soporta. **No se activa**: rompería todas las llamadas.
- **¿El cliente nota el tono?** Misma frase neutra ("Pasame el DNI del titular así reviso la cuenta"), generada con voz amable y con voz agresiva, 3 veces por combinación. Con 3.8 sin consigna, ninguna reacción al tono. Con una consigna que le pide fijarse en el tono, reacciona 1 de 3 veces al tono agresivo y también 1 de 3 al amable (falso positivo). El 2.5 con diálogo afectivo reacciona parecido y además a veces dice "[Número de DNI]" literal. Conclusión: hoy no se puede medir el tono de voz de forma confiable con Gemini Live; la mala manera en las palabras sí la ve el evaluador.
- **Evaluador con los 9 casos de MKT (3 corridas cada uno):** los casos con buenas conductas sacan entre 42 y 54 y los malos, entre 8 y 25; el caso de inyección no logró subir su puntaje. Pero los casos buenos pierden puntos porque las conversaciones sintéticas son anteriores a la `ficha`: los números de gestión no coinciden (por ejemplo, 4471-228 contra 4471-208) y en la del cliente agresivo escala "al supervisor" cuando la ficha dice Soporte de nivel 2. Falta decidir si se alinean las conversaciones con la ficha. Resultados en `evals/resultados/20261027-205509/`.

### 2026-10-27 · Botón Llamar en las salientes y ruido de línea (rama `feat/llamada-realista`)

- **Llamar:** en las llamadas salientes, la pantalla muestra a quién llamás y un número inventado pero fijo por escenario ("Diego Sosa · 11 6xxx-xxxx") con un botón verde **Llamar**. Recién al tocarlo suena el tono de llamada. Es el espejo de **Atender** en las entrantes: el candidato marca el inicio del contacto.
- **Ruido de línea:** un siseo suave de teléfono (`T.voice.linea`, ruido filtrado generado con Web Audio, sin archivos). Suena solo mientras habla el cliente, como el aire del otro lado en un celular: entra en 80 ms y se va en medio segundo (`hablando()`, según el estado "speaking" del motor). La primera versión sonaba toda la llamada y cansaba. Va con el interruptor "Voz telefónica" y con cualquier motor de voz. La cancelación de ruido del micrófono lo saca antes de mandarlo a la IA.
- **Estado:** `npm test` pasa 153 de 153 y `npm run test:e2e`, 37 de 37. Falta escucharlo con parlantes reales: si molesta o tapa la voz, se baja el volumen en `linea()`.

### 2026-10-27 · La sesión de Gemini Live se renueva para que no se pierda el acento (rama `feat/llamada-realista`)

- **Qué pasaba:** en una cobranza de 4 minutos, la voz se volvió neutra al final aunque las palabras seguían siendo argentinas ("mirá", "vos", "dale"). Lo que se pierde es cómo suena, no el lenguaje: con minutos de audio acumulado, el modelo vuelve a su tonada de fábrica y reforzar la consigna no alcanza.
- **Qué hace:** cada 2 minutos (`AJUSTES.renovarMs` en `voice.js`), cuando el cliente termina de hablar, se abre en paralelo una sesión nueva de Gemini Live con lo hablado como texto ("LA LLAMADA YA ESTÁ EN CURSO…") y, cuando está lista, se le pasa el micrófono y se cierra la vieja. No hay corte ni aviso. Si mientras se prepara alguien habló, se descarta y se prueba en el próximo silencio.
- **Costo:** un token efímero más cada 2 minutos y, por un segundo, dos sesiones abiertas.
- **Falta:** probarlo con la voz real en una llamada de 5 minutos o más. En la consola del navegador aparece "[voz] sesión renovada…" cada vez que pasa.
- **Estado:** `npm test` pasa 153 de 153 y `npm run test:e2e`, 36 de 36.

### 2026-10-27 · Transcripción sin "sho", prueba de audio y brief con lo que el operador tiene a mano (rama `feat/llamada-realista`)

- **"Sho" en la transcripción:** la consigna del acento escribía las palabras como suenan ("sho", "cashe") y el modelo las transcribía así. Ahora describe el sonido sin deletrearlo ("las palabras se escriben como siempre"), y `core.textoHablable` corrige las palabras más comunes (yo, ya, ella, calle, llamar, llegar…) por si se cuela alguna; "show" o "shopping" no se tocan.
- **Prueba de audio en el brief:** antes de "Empezar llamada" se elige micrófono y salida, hay una barra de nivel del micrófono y un botón "Probar sonido". Con Gemini Live la llamada usa esos dispositivos (y el timbre sale por la salida elegida); con los otros motores se usan los del sistema. La elección se guarda por usuario en el navegador.
- **"Lo que tenés a mano":** campo nuevo de los escenarios (`ficha`) que se muestra en el brief: lo que un operador vería en el sistema y las reglas de la campaña (cómo validar, qué puede ofrecer, plazos, número de gestión). Antes, en la cobranza el candidato no sabía el monto de la deuda ni que tenía que pedir DNI y fecha de nacimiento, y lo evaluábamos igual. Cargado en los 5 escenarios de MKT con clientes; el evaluador también lo ve. El DNI del cliente sigue sin mostrarse: se lo tiene que pedir.
- **Configuraciones guardadas antes del cambio:** los escenarios que vinieron de un ejemplo y no tienen `ficha` la toman del ejemplo al cargar la app (`completarDesdeEjemplos` en `app.js`), sin tocar lo que la empresa editó. Si la empresa la vació, queda vacía.
- **Brief:** se sacó la frase "Voz natural con Gemini Live…".
- **Estado:** `npm test` pasa 153 de 153 y `npm run test:e2e`, 35 de 35.

### 2026-10-27 · Llamada más realista: acento firme, timbre y voz telefónica (rama `feat/llamada-realista`)

- **Para qué:** la voz de Gemini Live arrancaba porteña y a mitad de la llamada se volvía neutra, y la llamada no se sentía como una llamada.
- **Acento:** la consigna decía solo "Español rioplatense, voseo" en medio de un texto largo; las voces de Gemini son neutras de fábrica y, a medida que la conversación crece, la instrucción pesa menos. Ahora hay una sección "TU ACENTO" al principio (pronunciación "sh" de la y y la ll, entonación porteña, voseo y palabras que no se usan) y un recordatorio al final de las instrucciones de Gemini Live. Falta confirmarlo con la voz real. Si no alcanza, el paso siguiente es mandar un recordatorio cada tantos turnos.
- **Timbre y botón Atender:** en las llamadas con un cliente suena el teléfono y el candidato atiende. En las entrantes, la voz conecta mientras suena (se disimula la demora) con el micrófono cerrado. En las salientes suena el tono de llamada argentino hasta que el cliente habla.
- **Voz telefónica:** filtro moderado (más ancho que un teléfono real, para que se entienda en parlantes de notebook), solo con Gemini Live. Viene prendido y se apaga en *Escenarios → Voz telefónica*.
- **Estado:** `npm test` pasa 149 de 149 y `npm run test:e2e`, 33 de 33. Falta probarlo con Gemini Live real y, si usan Vapi, con Vapi (el micrófono cerrado mientras suena no tiene prueba automática).

### 2026-10-27 · Llamadas que arranca el candidato y escenarios de MKT cargados

- **Para qué:** en un call center, en las llamadas entrantes saluda primero el operador. Si la IA arrancaba, el saludo y la validación de identidad no se podían observar.
- **Qué hay:**
  - Un campo nuevo en los escenarios, "Quién arranca la llamada" (`inicio`), con tres opciones: el cliente (por defecto), el candidato atiende (entrante) o el candidato llama (saliente).
  - El brief y la pantalla de la llamada le avisan al candidato ("Atendiste la llamada: saludá vos primero").
  - Los tres motores de voz respetan el campo. En Vapi se usa `assistant-waits-for-user`: no hay prueba automática, así que hay que probarlo con Vapi real.
- **Escenarios de MKT:** cargados como empresa de ejemplo `mkt` ("Cargar ejemplo"), con sus 6 escenarios y los criterios propuestos con pesos iguales y provisorios. Cada cliente tiene un DNI que solo conoce la IA, para practicar la validación.
- **Golden set:** las conversaciones se reescribieron para que arranquen como en la realidad, con saludos de distinta calidad, para que haya algo que observar. Siguen sin `esperado`.
- **Estado:** unido a `master`. `npm test` pasa 142 de 142 y `npm run test:e2e`, 28 de 28. Falta que el equipo los pruebe por voz y que RR. HH. defina los pesos.

### 2026-10-27 · Cuentas de prueba automáticas

- **Para qué:** probar la app con solo `npm start`, sin crear cuentas a mano.
- **Qué hace:** si no hay ningún usuario, el servidor crea `candidato-demo`, `junior-demo` y `empresa-demo`, todas con la clave `1234`.
- **Cuidado:** con `empresa-demo` y `1234`, cualquiera ve todos los informes. Por eso el servidor avisa en la consola mientras estén activas y hay que desactivarlas antes de usar la app con gente real. Reemplazan a las anteriores (`candidato` / `demo-candidato`, etc.).

### 2026-10-27 · Escenarios de call center para MKT y golden set (borrador, rama `feat/escenarios-mkt`)

- **Qué hay:**
  - `docs/escenarios-mkt.md`: 6 escenarios con los mismos campos que usa la app. Son sin internet, doble cobro, pedido de baja, cliente que insulta, cobranza y feedback de la team leader.
  - El contexto de una campaña ficticia (ConectAR), para no inventar datos de MKT.
  - Una propuesta de 6 criterios, con los pesos en blanco para RR. HH.
- **Golden set:** `evals/golden-mkt/` tiene 9 conversaciones sintéticas que describen solo lo que hace el candidato, más `planilla-rrhh.csv` para que dos personas puntúen cada caso. El `esperado` queda vacío a propósito: si lo pusiéramos nosotros, el evaluador se validaría contra nuestra propia opinión.
- **Estado:** borrador, sin cargar en la app. Falta la revisión del equipo y de RR. HH. y confirmar con MKT lo marcado como **[confirmar con MKT]**.

### 2026-10-27 · Pruebas del navegador al día (rama `feat/escenarios-mkt`)

- **Qué pasaba:** 9 pruebas de `npm run test:e2e` fallaban desde antes del login. En todos los casos la app había cambiado a propósito y las pruebas habían quedado viejas; ninguno era un error de la app:
  - Pesos nuevos de los criterios: el puntaje correcto es 71, no 81.
  - Ahora son 7 criterios, no 6.
  - La tarjeta del junior se llama "Resolver una tarea".
  - Los bloques del mentor se llaman [Cómo se hace] y [Por qué importa].
  - El primer escenario ahora es el de Tomás, por eso la prueba de voz elige el de Agustina.
  - El estado de la IA va a la consola, no a la pantalla.
- **Para decidir:** la lista de Informes de la empresa muestra solo los informes con el nombre actual de la empresa. Si se cambia el nombre (por ejemplo, de "MKT" a "MKT Contact Center"), los informes anteriores dejan de verse. La prueba ahora vuelve al nombre original.
- **Estado:** `npm test` pasa 129 de 129 y `npm run test:e2e`, 25 de 25.

### 2026-10-27 · Login y roles: implementado (rama `feat/login-roles`)

- **Qué hay:**
  - `auth.js`, que guarda usuarios, contraseñas y sesiones.
  - `npm run usuarios`, para crear y administrar las cuentas.
  - Sesión obligatoria en el servidor y permisos por rol.
  - Una llave local para que los scripts entren sin cookie.
  - En la interfaz: pantalla de ingreso, creación de contraseña en el primer ingreso, pantalla y color por rol, y un menú de la cuenta con "Cambiar contraseña" y "Salir".
- **Para la demo:** `GUIA-DEMO.md` explica las tres ventanas (`candidato.localhost`, `junior.localhost`, `empresa.localhost`). En Chromium está comprobado que cada una guarda su propia sesión.
- **Decisiones tomadas durante la implementación:**
  - El límite por IP es de 30 intentos fallidos por minuto, no 5, porque en un aula todos salen por la misma IP.
  - El 401 de "no ingresaste" lleva `type: "sin_ingreso"`, para no confundirlo con un 401 de un proveedor de IA.
  - Con la llave local, el informe conserva el nombre de candidato que manda el script (lo usan las evals).
- **Pendiente:** escenarios de call center para MKT, ajustes de voz y un ensayo. Después del viernes: pantalla de administración de cuentas y pasar el armado del prompt y la evaluación al servidor.

### 2026-10-27 · Login y roles: diseño aprobado (rama `feat/login-roles`)

- **Para qué:** demo del viernes 2026-10-30 con MKT Contact Center. Hoy cualquiera puede usar la IA, leer o borrar informes y cambiar la configuración, y el candidato escribe su propio nombre.
- **Decisiones:**
  - Tres roles: `estudiante` (se muestra como "Candidato"), `junior` y `empresa`.
  - Una cuenta por persona; la cuenta de empresa no es compartida.
  - Las cuentas se crean por consola (`npm run usuarios`), con un código inicial y la obligación de crear una contraseña en el primer ingreso.
  - La sesión va en una cookie `HttpOnly`.
  - Para la demo hay tres ventanas: `candidato.localhost`, `junior.localhost` y `empresa.localhost`.
- **Pendiente para después del viernes:** pasar el armado del prompt y la evaluación al servidor. Hoy un candidato podría ver la consigna o inventar su puntaje.
- **Detalle:** `docs/superpowers/specs/2026-10-27-login-y-roles-design.md`.
- **Estado:** diseño aprobado; la implementación está en la entrada de arriba.
