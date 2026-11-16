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

No hay build ni linter. El frontend es JS plano servido tal cual desde `public/`. Hace falta Node 20 o más.

**Las dependencias se instalan con el npm de Windows, nunca desde WSL.** `node_modules` tiene el binario de Windows del Agent SDK de Claude (`claude-agent-sdk-win32-x64`): un `npm install` corrido en WSL lo cambia por el de Linux y la IA deja de andar al correr la app en Windows. Desde WSL se instala con `cmd.exe /c "npm install <paquete>"`.

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
- **Informes (`backend/src/modules/simulaciones/`):** el controlador lee el pedido, el servicio decide quién ve qué y el repositorio guarda. `GET /api/informes` acepta los filtros `desde`, `hasta`, `candidato`, `escenario` y `empresa`, y `GET /api/informes/opciones` devuelve los candidatos y las simulaciones que existen, para los desplegables. `informes/filtro.js` es lógica pura (`normalizarFiltro`, `cumple`): entra lo que cumple `desde <= fecha < hasta`, el candidato se busca por una parte del nombre o del mail sin importar tildes ni mayúsculas y la simulación, por el título completo. Cada resumen lleva `usuarioId` y `email` de quien hizo la simulación: el mail lo pone el servidor al guardar el informe (`emailDe` en `informes/permisos.js`), solo para las cuentas que entran con Google; el que mande el navegador se descarta, y las cuentas con contraseña y los informes anteriores quedan con el mail vacío. El informe guarda también `escenario.id`, además del título. `repositories/informes-archivos.repository.js` es lo único que sabe dónde están guardados los informes: para las listas recibe el filtro y un **alcance** (`{ todos: true }` para la empresa, `{ usuarioId }` para el resto; cualquier otra cosa no ve nada) y devuelve resúmenes. Sus funciones son asíncronas para que el día que haya una base de datos se escriba otro repositorio con las mismas funciones (`leer`, `guardar`, `borrar`, `listarResumenes`, `listarOpciones`) y se cambie una sola línea, en `repositories/informes.repository.js`.
- **Exportación de informes (`backend/src/modules/simulaciones/exportar/`):** `GET /api/informes/exportar?formato=xlsx|pdf&zona=<zona horaria>`, más los filtros de la lista. Solo para `empresa`. Son tres pasos que no se conocen entre sí: los resúmenes los trae el repositorio (el servicio se lo pasa a `exportarInformes` como la función `obtenerResumenes`), `informes/dto.js` los convierte en filas (`aFilaExport`, y `COLUMNAS` es el único lugar que dice qué columnas hay) y un exportador por formato arma el archivo. Todos los exportadores tienen la misma forma, `{ extension, tipoMime, generar(filas, meta) }`: sumar un formato es otro archivo y una línea en `EXPORTADORES`. `exceljs` y `pdfmake` se cargan recién al exportar, no al arrancar. Las fechas salen en la zona horaria que manda el navegador. Hay un tope de 5.000 informes por archivo (`MAX_FILAS`). La respuesta lleva `x-informes` con la cantidad. En el PDF, `definicionPdf` (qué dice el documento) está separada de `generar`, y pdfmake no puede bajar nada de internet ni leer archivos que no sean sus tipografías. El PDF va apaisado; solo Simulación y Candidato se reparten el ancho que sobra, y un mail largo se corta antes de la arroba: un texto sin espacios en una columna de ancho libre ensancha toda la tabla y la saca de la hoja.
- **Audio de las simulaciones (`backend/src/modules/simulaciones/`: `audios.controller.js`, `audios.service.js`, `informes/audio-reglas.js` y el almacén `repositories/audios-archivos.repository.js`):** `PUT /api/informes/:id/audio` guarda la grabación de una llamada y `GET` la entrega. Reglas del servidor: la sube solo quien hizo la simulación, una sola vez y solo si en el informe consta que aceptó (`consentimientoAudio.aceptado === true`); la escuchan esa persona y la empresa (`loVe`, en `informes/permisos.js`); hasta 10 MB (`LIMITS.audio`); y el archivo se reconoce por sus primeros bytes (WebM, MP4 u Ogg), no por lo que diga quien lo sube. Se guarda en `DATA_DIR/audios/<id>.<extensión>` a través del almacén (`guardar`, `abrir`, `borrar`, `ids`), que es lo único que sabe dónde están. El servidor anota en el informe `audio: { mime, bytes, duracionSeg, subido }`; el navegador no puede mandar ese dato. Al guardar un informe, `consentimientoDe` deja la aceptación con la fecha del servidor (`registrado`). El audio se borra al borrar el informe y a los 90 días (`AUDIO_DIAS`, en `config/limits.js`): `limpiar` (en `audios.service.js`) corre al arrancar y una vez por día, borra también los audios que quedaron sin informe, y un audio vencido no se entrega aunque la limpieza todavía no haya pasado. Cuando se borra por vencimiento, el informe queda con `audio: { borrado, motivo }`.
- **Llave local:** los scripts de la compu (`chequeo`, `probar-ia`, `evals/puente.mjs`) no tienen cookie. Mandan el contenido de `DATA_DIR/llave-local.txt` en el encabezado `x-llave-local` y entran con permisos de empresa.

**Postgres (opcional al arrancar).** `backend/src/shared/db.js` abre el pool con `DATABASE_URL`, y recién cuando alguien lo pide: sin esa variable el servidor arranca igual. Las migraciones están en `db/migrations/` (`npm run db:migrar`). Hoy viven en Postgres las cuentas que entran con Google (su sesión trae `empresaId`) y el registro de simulaciones (tabla `simulaciones`). La configuración de la empresa, los informes y las cuentas con contraseña siguen en JSON. Para las pruebas de la base: `docker compose up -d` (puerto 55432; si no puede leer el `.env`, `docker compose --env-file /dev/null up -d`) y `TEST_DATABASE_URL`. Sin esa variable esas pruebas se saltean.

**Inicio de la empresa (`GET /api/empresa/inicio?dias=7|15|30`, sin `dias` vale 30).** Devuelve `{ dias, juniorsEnCapacitacion, simulaciones: { total, enPeriodo }, gasto: { moneda: "USD", total, enPeriodo }, informesRecientes }`; los informes son hasta 4, con la forma de la lista de `GET /api/informes`. Responde solo al rol `empresa` y solo si su cuenta está en Postgres: una cuenta con contraseña o un script local recibe 409 `sin_empresa`; un `dias` inválido, 400; si una fuente falla, 503. Cada simulación se registra en `POST /api/informes`: si quien guarda tiene `empresaId`, primero se inserta la fila de `simulaciones` con `precio_usd` (el precio vigente, congelado) y después se guarda el informe JSON con `simulacionId` y `empresaId`, que pone solo el servidor (lo que mande el navegador en esos campos se descarta). Si no se puede registrar, responde 503 y no guarda el informe; si no se puede guardar el informe, anula la simulación. Borrar un informe no borra su simulación: sigue contando en simulaciones y en gasto. El precio es `PRECIO_SIMULACION_USD` (provisorio) en `simulaciones.service.js`, y nadie lo lee directo: se pide por `precioVigenteUsd()`, porque a futuro se va a editar desde un panel de administración y se va a leer de la base. No se confunde con `shared/utils/precios.js`, que son los precios de los modelos de IA (lo que nos cuestan a nosotros). Los módulos siguen sin importarse entre sí: `backend/src/routes.js` es el único lugar que junta las fuentes de `auth` y `simulaciones` y se las pasa a `empresa/inicio.service.js`. Diseño: `docs/superpowers/specs/2026-11-13-home-empresa-design.md`.

**Proveedores de IA.** Hay tres, configurados por `.env`:
- `claude-sdk`: el Claude Agent SDK (Claude Code con la suscripción de la máquina), usado solo como modelo de texto, sin herramientas y en un directorio vacío (`opcionesSdk`).
- `anthropic`: la API de Anthropic por `fetch` directo, no con `@anthropic-ai/sdk`.
- `gemini`: por su endpoint compatible con OpenAI.

`LEEME.md` dice que el proveedor por defecto es `gemini`, pero en el código es `claude-sdk` (`PRIMARY`). El flujo general es `responder()` → `conReintentos()` → `intentar()` → `RUN[id]`, con backoff y paso al proveedor de respaldo según el código de error (`esReintentable`, `pasaAlRespaldo`).

**La evaluación tiene un camino propio (`responderEval`).** Usa su propia cadena (`EVAL_CADENA`, configurable con `LLM_EVAL_CADENA`). Hace una "carrera" (`carreraEval`): si `claude-sdk` no termina en `EVAL_CARRERA_MS`, lanza un segundo intento en paralelo y gana el primer informe válido. El texto no se transmite a medida que llega: `intentar` lo acumula, lo valida con `core.parseEvaluacion` y lo entrega completo. Para Gemini fuerza el JSON con `EVAL_SCHEMA`; si cambiás los campos del informe, actualizá ese esquema, el prompt y el parseo a la vez.

**Código compartido entre navegador y Node.** `public/js/core.js` es UMD: el servidor y los tests lo importan con `require`, y el navegador lo expone en `window.T.core`. Contiene la lógica pura: historial, `extraerJSON`/`parseEvaluacion`, `puntajeCriterio`/`puntajePonderado` (puntaje de 0 a 100 a partir de criterios de 1 a 5, con `VALOR_NIVEL`: 1 = 0, 2 = 35, 3 = 65, 4 = 85, 5 = 100; los criterios en `null` quedan fuera), la migración de la configuración y los tiempos de la grabación: `cronometroDeTurnos` (con los eventos del motor de voz calcula en qué segundo empieza y termina cada turno; el del candidato empieza donde terminó el turno anterior y termina cuando llega su texto, porque Gemini Live manda la transcripción cuando la persona termina de hablar, no mientras habla) `ubicarCita` (encuentra en qué turno hablado del candidato está una cita del informe y en qué parte del texto de ese turno, `desde` y `hasta` de 0 a 1; si no se parece lo suficiente a ninguno, devuelve `null`) `tramoDeCita` (con el volumen del turno saca los silencios y reparte el texto sobre lo hablado para estimar qué segundos hacer sonar, y si hay una pausa cerca del comienzo estimado arranca después de la pausa; si no distingue ninguna voz, devuelve el turno entero), `tiemposDePalabras` (en qué segundo empieza cada palabra de la cita, para iluminarla mientras suena) y `comoSeDice` (el texto con los números como se dicen: "38.000" es "treinta y ocho mil" y un número de 7 cifras o más va cifra por cifra; las tres funciones anteriores miden el texto así, porque un número se escribe corto y se dice largo). `prompts.js` y `defaults.js` solo existen en el navegador (`window.T.prompts`, `T.DEFAULTS`). Cuando Node necesita esos archivos, los carga en un contexto `vm` (ver `evals/puente.mjs`).

**Frontend (`public/js/app.js`).** Es una SPA sin framework: `VIEWS[nombre]`, `go()` y el estado en `S`. Al arrancar, `boot()` → `entrar()` pide `/api/yo`; sin sesión muestra `VIEWS.login` (`body.sin-sesion` oculta la barra lateral). El perfil sale del rol de la sesión: ya no hay selector de perfil ni campo de nombre. Cada rol tiene su pantalla de inicio (`INICIO`) y su color (`body[data-rol]`). El `localStorage` se separa por usuario (`k()`). Un 401 `sin_ingreso` en cualquier pedido lleva al ingreso con aviso (`T.api.onSinSesion`). Hay tres perfiles: estudiante (se muestra como "Candidato": simulación por voz e informe), junior (chat con el mentor) y empresa (configura contexto, escenarios y criterios, y ve los informes). El informe se arma en el navegador (`runEvaluation`): prompt de `T.prompts.evaluacion`, `purpose: "eval"`, parseo y puntaje con `core`, y después `POST /api/informes`. El servidor lo guarda casi como llega: descarta `simulacionId` y `empresaId` si vienen del navegador y, para las cuentas de Postgres, los pone él (ver "Inicio de la empresa"). Candidato y empresa ven la misma vista (`VIEWS.report`). Las dos listas de informes ("Mis informes" e "Informes" de la empresa) usan `listaDeInformes` y `barraFiltros`: fechas, simulación y, solo para la empresa, candidato. El navegador convierte los días elegidos en instantes con `core.rangoDeDias` (en la hora de la persona, para que "hasta el 10" incluya todo el 10) y filtra el servidor. Lo elegido queda en `S.filtros` y la última lista, en `S.listaInformes`, así al volver de un informe se ve igual. `S.informes` es otra cosa: todos los informes del candidato, sin filtros, para "Tus simulaciones" del inicio. En la lista de la empresa, dos botones (Excel y PDF) bajan lo que está en pantalla: usan el filtro de la última búsqueda mostrada, no lo que se está tipeando (`exportable` en `listaDeInformes`).

**Datos de la llamada (`metricas` en el informe).** Al terminar la llamada, `core.metricasDeLlamada` resume lo que pasó además de lo que se dijo: turnos y palabras de cada lado, qué parte de lo dicho fue del candidato, su respuesta más larga, el tiempo de los turnos (solo con grabación), cuántas veces interrumpió al cliente, quién cortó, el uso de "Lo que tenés a mano" (aperturas y datos copiados), respuestas escritas con el teclado, veces que silenció el micrófono, y el motor de voz con sus avisos de error. `VIEWS.call` anota esos hechos en `uso` mientras dura la llamada y `finishCall` arma las métricas; `runEvaluation` las guarda en el informe. Los motores avisan con el evento `interrupt` cuando el candidato le habla encima al cliente (solo Gemini Live); tocar la esfera mientras habla también cuenta. En `VIEWS.report`, `core.describirMetricas` las pasa a frases para el bloque "Datos de la llamada", que se muestra solo al rol empresa. Se calculan en el navegador, sin IA; no cambian el puntaje ni se le pasan al evaluador. `metricas.version` vale 1: si cambia el significado de un campo, se sube.

**Quién arranca la llamada.** El campo `inicio` del escenario define quién habla primero: sin el campo, el cliente (como siempre); `"atiende"` (llamada entrante: `vozInicio` devuelve `null` y los tres motores esperan a que hable el candidato); `"llama"` (llamada saliente: el cliente atiende solo con "¿Hola?"). El prompt de voz y el de evaluación lo mencionan solo si el campo está, así los escenarios viejos no cambian.

**Voz (`public/js/voice.js`).** Tres motores con la misma interfaz: `gemini-live` (por defecto, voz a voz por WebSocket directo a Google con un token efímero de `/api/voz/token`), `vapi` y `browser`. La transcripción que generan es la que después se evalúa.

**Por qué Gemini Live no pasa por el backend.** El navegador abre el WebSocket directo a Google (el servidor solo mintea el token efímero: un uso, ~30 min, atado al modelo). Así el audio no hace el salto extra navegador → server → Google, que en voz a voz se nota en la latencia; la `GEMINI_API_KEY` no sale del servidor y el servidor no sostiene un WebSocket de audio por llamada. El costo: el backend no ve nada de la llamada. Si hace falta verlo, el navegador lo reporta (ver tokens abajo) o habría que hacer un proxy WebSocket en el backend (ve todo y da números exactos, pero suma latencia y carga; no se hizo).

**Tokens de la llamada de voz (Gemini Live).** `voice.js` suma el `usageMetadata` que Google manda una vez por turno (`promptTokenCount` ya incluye todo el contexto de ese turno; se asume que cada turno se cobra entero, sin verificar todavía contra la facturación de Google; las sesiones renovadas también cuentan) y, al colgar (`liberar()` → `informarUso()`), hace `POST /api/voz/uso` con `fetch` `keepalive`. `voz.service.registrarUso` escribe una línea `[VOZ] gemini-live · modelo · llamada · Ns · usuario=… · N turnos · tokens in=… (texto/audio) out=… (audio/texto) pensamiento=…` en la terminal y en `data/logs/ia-AAAA-MM-DD.log` (el mismo archivo del log de la IA). Límites: si cierran la pestaña de golpe el reporte puede perderse, y un navegador modificado podría mandar números falsos, así que sirve para ver consumo, no como facturación confiable. Los tokens de pensamiento se cobran como salida.

**Costos en el log.** `backend/src/shared/utils/precios.js` tiene los precios hardcodeados de Gemini Live y Claude (por millón de tokens) y calcula el costo: la línea `[VOZ]` suma `costo=US$…` y `logIA` agrega el costo a cada consulta a Claude, incluidos los intentos fallidos de la evaluación. Con `claude-sdk` figura como "costo equivalente por API", porque la suscripción no paga por token. Los modelos sin precio cargado (hoy, el Gemini de texto de respaldo) salen sin costo. `npm run costos [-- archivo.log] [-- --solo-resumen]` completa un log viejo (deja `.bak`) y muestra los totales. Supuestos: pensamiento a la tarifa de salida de texto, el alias `sonnet` = `claude-sonnet-5-5`, `haiku` = `claude-haiku-5-5` y caché de 5 minutos (escribir 1,25x, leer 0,1x). Si la key de Gemini está en el plan gratuito, la voz no se paga: el número es lo que costaría en el plan pago.

**Costo de una simulación completa.** Cuando están la llamada y su informe, el log suma una línea `[SIM] #pedido simulación · llamada US$… + informe US$… = total US$…`. El navegador genera un id por llamada (`S.simulacion` en `VIEWS.call`) y lo manda en `/api/voz/uso` y en la evaluación (`simulacion`, no llega al proveedor); `shared/utils/costo-simulacion.js` los une en memoria, en cualquier orden, y dos horas después descarta lo que quedó sin par. El informe suma todos sus intentos con tokens, incluidos los fallidos y los del Reintentar; un intento cancelado no informa tokens y no suma. Una llamada sin informe (muy corta) no tiene línea `[SIM]`, y tampoco los motores `vapi` y `browser`, que no informan tokens. `npm run costos` agrega `[SIM]` a logs viejos uniendo por hora (±5 s).

**Llamada por teléfono (`VIEWS.call` en `app.js`).** En los escenarios por teléfono con un cliente (no en persona ni con el líder) suena un timbre (`T.voice.tono`, generado con Web Audio) y el candidato toca **Atender**; mientras suena, la pantalla muestra solo ese botón, al centro (`.call.sonando`). Si `inicio` es `"atiende"`, el motor conecta mientras suena, con el micrófono silenciado, y el botón se habilita cuando la voz está lista. Si habla primero el cliente, el motor arranca al atender. En las salientes (`"llama"`) el candidato toca **Llamar** y suena el tono de llamada hasta que el cliente empieza a hablar. Con la voz telefónica, al conectarse suena un ruido de línea suave de fondo (`T.voice.linea`). Con Gemini Live, la voz del cliente pasa por un filtro telefónico (`telefono()` en `voice.js`) salvo que `cfg.vozTelefonica` sea `false`. El acento rioplatense lo sostiene la sección "TU ACENTO" de `prompts.js` y la renovación de la sesión de Gemini Live cada 2 minutos (`quizasRenovar` en `voice.js`, en un silencio y sin corte); describe el sonido sin escribir las palabras como suenan, porque si no la transcripción sale con "sho" (`core.textoHablable` corrige lo que se cuele). Antes de la llamada, el brief tiene una prueba de audio (`pruebaDeAudio` en `app.js`): micrófono, salida, nivel y sonido de prueba; lo elegido queda en `S.audio` y lo usa Gemini Live. Lo que la vista deja abierto se cierra en `render()` con `S.alSalirDeVista`.

**Grabación de la simulación (`public/js/grabadora.js`, `T.audio`).** Solo con Gemini Live y solo si el candidato marca la casilla del brief (`casillaDeGrabacion`; el texto y su versión están en `GRABACION`, en `app.js`, y si cambia el texto hay que cambiar la versión). La casilla arranca sin marcar en cada simulación. `crearGrabadora()` no conoce al motor: el motor le entrega su contexto de audio, el micrófono y la voz del cliente (`conectar`), le avisa cuando se silencia el micrófono (`micAbierto`) y la frena **antes** de cerrar el audio (`terminar`; si se cierra primero, se pierde el último tramo y la grabadora queda colgada). Graba en un solo canal, en Opus, desde que la llamada se atiende (`empezar`): mientras suena el teléfono no. `VIEWS.call` guarda en cada turno `t0` y `t1` (segundos de la grabación) con `core.cronometroDeTurnos`; un turno escrito con el teclado no los lleva. Después de guardar el informe, `subirAudioDe` sube el audio aparte; si falla, el informe queda igual, sin audio. En `VIEWS.report`, junto a cada cita que `core.ubicarCita` encuentra en un turno hablado del candidato hay un botón que hace sonar la parte de ese turno donde está la cita, con medio segundo de margen antes y uno después (`crearReproductor`): el reproductor mide el volumen del turno (`volumen`) y `core.tramoDeCita` estima el tramo. Mientras suena, las palabras de la cita (`.palabra`) pasan del gris al color del texto (`.dicha`) según `core.tiemposDePalabras` y el segundo que va sonando (`reproductor.segundo()`). Es una estimación por volumen, sin reconocimiento de voz ni costo: no sabe qué palabra suena en cada momento. El reproductor baja el audio con el primer clic, lo decodifica entero y toca el tramo con Web Audio, porque estas grabaciones no traen duración ni índice y con `<audio>` no se puede saltar a un segundo; libera la memoria al salir de la vista. Si el escenario tiene `ficha`, durante la llamada un botón abre "Lo que tenés a mano" (`.ficha-panel`: columna a la derecha; en pantallas chicas, hoja desde abajo), con un botón para copiar cada dato. Se cierra con Esc y queda abierto o cerrado por usuario (`k("fichaAbierta")`). El brief y la llamada arman la lista con las mismas funciones (`fichaItems` y `fichaLista`).

**Caché de prompts.** El prompt del mentor está ordenado para que la parte estable vaya primero (`system_estable` indica hasta dónde). `test/prompts.test.mjs` compara contra `test/fixtures/prompts-antes.js` que el texto que recibe el modelo no cambie. Si modificás `prompts.js` a propósito, actualizá ese fixture.

## Tests

- Ningún test usa la API real. `test/helpers.mjs` (`startApp`) arranca `backend/server.js` en un proceso aparte, con `DATA_DIR` temporal y las URLs de los proveedores apuntando a `test/fake-llm.mjs`.
- El Agent SDK se reemplaza con `CLAUDE_SDK_MODULE` (por ejemplo, `test/fake-sdk-*.mjs`).
- `startApp` siembra usuarios (`estudiante1`, `estudiante2`, `junior1`, `empresa1`, con clave `clave-de-prueba`, y `nuevo1`, que entra con `app.codigoNuevo`) y entra como `empresa1`. `pedir()` y `pedirMensajes()` mandan esa cookie salvo `{ cookie: null }` u otra. En Playwright se usa `ingresarEn(page, base, usuario)` y `salirEn(page)`.
- Cuando agregues una variable de entorno que lea el servidor, neutralizala en `startApp` para que no se filtre el `.env` real.
- `test/helpers-pg.mjs` es el equivalente para las pruebas con Postgres: da `crearEsquema`, `crearEmpresa`, `crearUsuario`, `simHace` (una simulación de hace N días con un precio), `cookieDe` (cookie de sesión firmada), `appConPostgres` e `INFORME_PRUEBA`. Cada archivo de prueba usa un esquema propio al azar y lo borra al terminar. Esas pruebas necesitan `TEST_DATABASE_URL`; sin eso se saltean.
- La voz del navegador (`speechSynthesis`) depende del sistema: el Chromium de Linux no trae ninguna voz. Una prueba que necesite que el cliente esté "hablando" usa la voz simulada de `test/helpers.mjs` (`vozSimuladaEn`, `vozSimuladaDe`, `vozRealEn`), que además registra qué se dijo y si se cortó.
- La grabación se prueba en `test/voz-gemini.test.mjs` con el Gemini simulado y el micrófono falso de Chromium: que sin aceptar no se arme ninguna grabación ni se pida nada de audio al servidor, y que aceptando el audio quede guardado, se pueda decodificar y tenga la voz del cliente en el tramo que dicen los tiempos. `startApp({ sembrar })` deja archivos en la carpeta de datos antes de arrancar el servidor (para probar la limpieza de audios) y `pedirBytes` manda y recibe archivos.
- El contenido del Excel y del PDF se prueba en `test/exportar.test.mjs`, sin servidor. Las pruebas del servidor y del navegador solo comprueban que salga un archivo del formato pedido con la cantidad de informes correcta (`x-informes`), y las del servidor usan PDF: cargar `exceljs` desde WSL tarda unos 35 segundos (son 662 archivos chicos en `/mnt/c`; en Windows, medio segundo), así que conviene cargarlo en la menor cantidad de procesos posible.
- Todo se corre en los dos sistemas antes de darlo por terminado: hay errores que aparecen en uno solo (las rutas con `\` en Windows, las voces en Linux).
- En Playwright, un clic sobre algo que se mueve (la esfera late mientras habla el cliente) espera a que se quede quieto. Si el clic tiene que llegar en ese momento, va con `{ force: true }`.

## Evals (`evals/`)

Hoy hay 5 casos sintéticos, todos del escenario `incidente-viernes` de Nodo, con rangos esperados que todavía no revisó RRHH. Para tener un golden set hacen falta entre 40 y 50 casos puntuados a mano por una licenciada en RRHH, la mayoría conversaciones reales de un piloto.

`evals/golden-mkt/` tiene 9 casos sintéticos de los escenarios de call center (empresa de ejemplo `mkt` en `defaults.js`, borrador en `docs/escenarios-mkt.md`) con `esperado: null`. El rango esperado lo decide RR. HH. con `planilla-rrhh.csv` (dos personas por caso), nunca quien escribió los casos ni la IA. `test/mkt.test.mjs` verifica que los casos coincidan con los escenarios.

`evals/calibracion-mkt/` tiene 5 conversaciones sintéticas de la cobranza de MKT, de excelente a falla de compliance, con rangos esperados provisorios puestos por nosotros. Sirven para comprobar que el evaluador ordena bien las llamadas y que seguir el guion de la campaña (`p-cobranza` y la `ficha`) da un puntaje alto. No reemplazan al golden set.

`run_evals.py` corre las transcripciones de `evals/transcripciones/*.json` por el evaluador real. No reimplementa nada: delega en `puente.mjs`, que usa el mismo prompt, el mismo `system` y el mismo `max_tokens` que `app.js` (los lee del código fuente) y el `POST /api/messages` de un servidor levantado. Cada caso trae los rangos esperados por criterio en `esperado`. Los resultados van a `evals/resultados/<AAAAMMDD-HHMMSS>/` (`resumen.csv`, `criterios.csv`, `corridas.csv`, `crudo.jsonl`).

## Bitácora

Registro paso a paso de los cambios del programa: qué se decidió, por qué y dónde está el detalle. Se actualiza en cada paso, con el más nuevo arriba. Cuando algo se implementa, se describe también en la sección de arquitectura que corresponda.

### 2026-11-16 · Datos de la llamada en el informe (rama local `local/integracion-perfil-empresa`)

- **Para qué:** el pedido era evaluar qué otra información conviene registrar (flujo de la conversación, métricas secundarias). El informe decía qué se dijo y cómo se evaluó, pero no cómo fue la llamada.
- **Qué hay:** cada informe nuevo guarda `metricas` y la empresa ve un bloque "Datos de la llamada" en el informe, antes de la conversación completa. El detalle de los campos está en "Datos de la llamada" de Arquitectura.
- **Decisiones del usuario:** se implementan tres grupos (flujo de la conversación, uso de las ayudas y datos técnicos); el bloque lo ve solo la empresa; por ahora no van al Excel ni al PDF.
- **Decisiones técnicas:**
  - Se calculan en el navegador con lo que la app ya sabe: sin IA, sin costo y sin tocar el servidor ni el evaluador.
  - No se guarda "palabras por minuto". El turno del candidato va desde que terminó el cliente hasta que terminó de hablar, así que incluye la pausa de antes de contestar: el número daría más lento de lo que la persona habla. Se guarda el tiempo de los turnos y el informe lo aclara.
  - No se guarda cuántos intentos necesitó el evaluador: eso pasa en el servidor y el navegador no lo ve.
  - Una interrupción se cuenta cuando el candidato le habla encima al cliente (evento nuevo `interrupt`, solo Gemini Live) o toca la esfera mientras el cliente habla.
- **Límites:**
  - Las calcula el navegador, igual que el informe: alguien con conocimientos técnicos las podría alterar. Se resuelve cuando la evaluación pase al servidor.
  - "Solo la empresa" es lo que muestra la pantalla: el dato viaja dentro del informe, que el candidato también puede pedir. No es información sensible para él (es lo que hizo en su propia llamada).
  - Con Vapi y con la voz del navegador no se detecta que el candidato hable encima: solo cuentan los toques en la esfera.
  - Los informes anteriores no tienen `metricas` y no muestran el bloque.
- **Queda como propuesta, sin implementar:** intentos por escenario y llamadas abandonadas (necesita guardar llamadas sin informe en el servidor), pasos del guion cumplidos (cambia el evaluador y hay que recalibrar) y demora en responder y silencios (solo se puede medir con la grabación).
- **Estado:** con el Node de Windows y Postgres prendido, `npm test` pasa 361 de 362 (falla solo la de SIGTERM) y `npm run test:e2e`, 48 de 48. **Falta verlo con una llamada real de Gemini Live.**

### 2026-11-16 · Mail e IdUsuario en la exportación, búsqueda por mail y `escenario.id` en el informe (rama local `local/integracion-perfil-empresa`)

- **Para qué:** identificar a cada candidato sin depender del nombre (dos personas se pueden llamar igual) y poder asociarlo con su cuenta.
- **Qué hay:**
  - El Excel y el PDF suman las columnas Mail e IdUsuario, después de Candidato.
  - En "Informes" de la empresa, el campo Candidato encuentra también por una parte del mail.
  - Cada informe nuevo guarda `email` (lo pone el servidor) y `escenario.id` (lo manda el navegador con el resto del escenario).
- **Decisiones:**
  - El mail sale de la sesión, nunca del navegador, igual que el nombre del candidato.
  - Solo tienen mail las cuentas que entran con Google. Las de contraseña tienen un nombre de usuario: la columna queda vacía, no se pone ahí algo que no es un mail.
  - Los informes anteriores quedan con Mail vacío: no se busca el mail en la base de usuarios al exportar, para que la exportación no dependa de ella.
  - El resumen de las listas es uno solo, así que los informes recientes del inicio de la empresa también traen `usuarioId` y `email`. **Hay que avisarle a Fran**: se ajustó su prueba de `test/inicio.test.mjs` que compara la forma exacta.
  - El PDF pasó a apaisado: con siete columnas no entraba en vertical.
- **Error que apareció al mirar el PDF:** con un mail largo, la tabla se salía de la hoja. Las columnas de ancho libre de pdfmake miden todas lo mismo y, si una tiene un texto sin espacios más ancho que su parte, se ensanchan todas. La columna Mail ahora tiene ancho fijo y un mail de más de 30 caracteres va en dos líneas, cortado antes de la arroba. Las pruebas de la definición no lo veían: solo se vio generando el archivo y mirándolo.
- **Lo que no cambia:** el esquema de Postgres. `escenario_id` de la tabla `simulaciones` sigue en NULL porque los escenarios todavía no están en la base.
- **Estado:** con el Node de Windows y Postgres prendido, `npm test` pasa 355 de 356, sin salteadas (falla solo la de SIGTERM, que en Windows falla siempre); sin Postgres, 316 de 322. `npm run test:e2e`, 48 de 48.

### 2026-11-16 · El inicio de la empresa unido con las funciones de MKT (rama local `local/integracion-perfil-empresa`)

- **Qué es:** la rama parte de `feat/perfil-empresa` (PR 8) y le une `local/login-y-simulaciones` (ficha, filtros, exportar y audio, con el login con Google). Es solo local: no se subió nada.
- **Lo que chocaba:**
  - `informes.service.js`: las dos ramas reescribían `crear`. Quedó en este orden: aceptación de la grabación, registro de la simulación en Postgres (si la cuenta tiene `empresaId`) y guardado del informe; si el guardado falla, se anula el registro.
  - `package.json`: las pruebas de las dos ramas, sumadas.
  - `CLAUDE.md`: se conservan las dos bitácoras, y el párrafo del frontend dice que el servidor descarta `simulacionId` y `empresaId`.
- **Lo que git no marcaba:** `recientes()` (los informes del inicio de la empresa) usaba `repo.listar()`, que ya no existe: el inicio habría respondido siempre 503. Ahora pide `listarResumenes` con un alcance nuevo, `{ empresaId }`, en `informes-archivos.repository.js`. Con `usuarioId` en el alcance manda la persona; un `empresaId` vacío no ve nada.
- **Cambio visible:** los informes recientes del inicio traen también `duracionSeg`, como la lista de `GET /api/informes`. Se actualizó la prueba de `test/inicio.test.mjs` que comparaba la forma exacta.
- **Estado:** con el Node de Windows y Postgres prendido (`docker compose up -d` y `TEST_DATABASE_URL`), `npm test` pasa 353 de 354, sin salteadas: falla solo la de SIGTERM, que en Windows falla siempre. Sin Postgres, 314 de 320 (5 salteadas). `npm run test:e2e`, 48 de 48. En WSL, las pruebas que levantan el servidor chocan con el tope de 10 segundos de arranque (cargar las librerías del login desde `/mnt/c` es lento): en esta rama se corren con el Node de Windows.

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

### 2026-11-13 · Las cinco funciones de MKT, pasadas al servidor por capas (rama `feat/informes-y-audio`)

- **Qué se hizo:** la calibración de MKT, la ficha en la llamada, los filtros, la exportación y el audio se habían hecho sobre el `server.js` de un solo archivo. Acá están sobre el `master` de GitHub, que ya tiene el servidor por capas, en cinco commits (uno por función).
- **Dónde quedó cada cosa (`backend/src/modules/simulaciones/`):**
  - `informes/`: lógica pura, sin HTTP ni archivos (`filtro.js`, `dto.js`, `permisos.js`, `audio-reglas.js`).
  - `repositories/`: lo único que sabe dónde se guarda. `informes-archivos.repository.js` y `audios-archivos.repository.js` son las fábricas; `informes.repository.js` y `audios.repository.js` eligen cuál usa la app.
  - `services/`: las reglas (`informes.service.js`, `audios.service.js`).
  - `controllers/`: leen el pedido y responden (`informes.controller.js`, `audios.controller.js`).
  - `exportar/`: un exportador por formato.
- **Lo que cambió respecto de la versión anterior:**
  - El repositorio de informes es uno solo y asíncrono (`leer`, `guardar`, `borrar`, `listarTodos`, `listarResumenes`, `listarOpciones`). Era lo que faltaba para la migración a PostgreSQL: se cambia una línea en `informes.repository.js`.
  - `AUDIO_DIAS` está en `config/limits.js`, porque lo usan dos módulos (`ia`, para decírselo al navegador, y `simulaciones`) y un módulo no importa de otro.
  - Las reglas del audio que no tocan archivos (`consentimientoDe`, `audioVencido`) salieron del almacén y están en `informes/audio-reglas.js`.
- **No se sumó `.gitattributes`:** en GitHub hay 5 archivos con CRLF (`app.js`, `api.js`, `styles.css`, `LEEME.md`, `test/cache.test.mjs`). Se respetó el final de línea de cada uno para que el PR muestre solo lo que cambió. Pasar todo a LF queda para un PR aparte.
- **Para saber:**
  - En Windows falla `con SIGTERM el proceso termina enseguida` (`test/despliegue.test.mjs`): Windows no entrega SIGTERM al proceso, lo corta. Falla igual sin estos cambios; en Linux, que es donde corre en AWS, pasa.
  - `npm audit` marca 6 avisos que ya estaban en el `master` de GitHub (paquetes internos del Agent SDK). Las dos librerías nuevas no suman ninguno. No se corrió `npm audit fix`.
- **Falta:** lo mismo que en las entradas de abajo (escuchar las citas con voz real y que un abogado revise el texto de la casilla), y sumar a las tablas de PostgreSQL de `feat/postgres-esquema` los tiempos de cada turno, el audio y el consentimiento.
- **Estado:** `npm test` pasa 289 de 289 en WSL y 288 de 289 en Windows (la de SIGTERM); `npm run test:e2e`, 48 de 48 en los dos.

### 2026-11-12 · Ajuste del arranque de las citas y palabras que se iluminan (rama `feat/audio-en-informes`)

- **Qué pasaba:** al escuchar la llamada real, algunas citas arrancaban con un poco de lo que el candidato había dicho antes.
- **Por qué:** el margen de un segundo antes del tramo; los números, que se escriben cortos y se dicen largos (el texto se repartía por letras, así que lo anterior a la cita parecía durar menos); y lo que se dice y no queda en la transcripción ("eh…", repeticiones).
- **Qué cambió:**
  - Los números se cuentan como se dicen (`comoSeDice` en `core.js`): hasta 6 cifras, en palabras ("38.000" → "treinta y ocho mil"); con 7 o más, o si empieza con cero, cifra por cifra (un DNI, un número de gestión).
  - Si la voz vuelve después de una pausa de 0,25 segundos o más a menos de 0,8 segundos del comienzo estimado, la cita arranca ahí (`PAUSA_SEG`, `CERCA_DE_UNA_PAUSA_SEG`).
  - El margen de antes bajó de 1 a 0,5 segundos; el de después sigue en 1 (`MARGEN_ANTES_SEG`, `MARGEN_DESPUES_SEG` en `grabadora.js`).
  - Mientras suena, las palabras de la cita se van iluminando (`tiemposDePalabras`). Es la misma estimación: en una cita larga la luz puede ir un poco adelantada o atrasada respecto de la voz.
- **Cómo se eligió la regla de los números:** con la llamada real se midió el ritmo de cada turno del candidato. Contando solo letras, los turnos con números daban 17,4 letras por segundo y los demás, 19,5. Contando los números cifra por cifra, 21,1; como se dicen, 20,9. Las dos emparejan el ritmo; se eligió "como se dicen" porque dentro del turno reparte mejor ("6333" son 34 letras dichas y 19 cifra por cifra). Es una sola llamada: si con más llamadas se ve otra cosa, se revisa.
- **Lo que no arregla:** lo dicho que no está en la transcripción sigue corriendo el cálculo. Exacto a la palabra solo se logra con reconocimiento de voz con tiempos, que se descartó por el costo.
- **Estado:** `npm test` pasa 272 de 272 y `npm run test:e2e`, 48 de 48, en WSL y en Windows. **Falta escucharlo.**

### 2026-11-11 · El botón de una cita hace sonar la frase, no el turno entero (rama `feat/audio-en-informes`)

- **Para qué:** un turno del candidato puede durar 30 segundos y la cita, 3. Además el turno empieza con el silencio de antes de hablar.
- **Qué hace:** al tocar el botón, el reproductor mide el volumen del turno cada 0,05 segundos (`volumen` en `grabadora.js`) y `core.tramoDeCita` saca los silencios y reparte el texto sobre lo hablado: si la cita ocupa del 42 % al 47 % del texto del turno, suena del 42 % al 47 % del tiempo hablado, con un segundo de margen a cada lado. `ubicarCita` ahora devuelve también esa posición (`desde`, `hasta`).
- **Decisión:** no agregar costo. Es una cuenta en el navegador sobre el audio que el reproductor ya decodifica: sin servidor, sin IA y sin mandar la voz a otro servicio. La alternativa exacta a la palabra es un reconocimiento de voz con tiempos por palabra (pago, y habría que cambiar el texto del consentimiento); queda para más adelante si la estimación no alcanza.
- **Es una estimación:** supone que la persona habla a ritmo parejo dentro del turno. En un turno largo puede correrse uno o dos segundos. Si no distingue ninguna voz, suena el turno entero.
- **Con la llamada real:** "Tres cuotas de 6333", dentro de un turno de 38 segundos, queda en un tramo de 2,2 segundos; las otras cinco citas, entre 5 y 19 segundos según su largo. **Falta escucharlas**: los tramos se calcularon, pero nadie los oyó todavía.
- **Si hay que ajustar:** el margen es `MARGEN_SEG` en `grabadora.js`; el umbral de voz, `PARTE_DEL_VOLUMEN_FUERTE` y `PISO_DE_VOZ` en `core.js`.
- **Estado:** `npm test` pasa 262 de 262 y `npm run test:e2e`, 48 de 48, en WSL y en Windows.

### 2026-11-11 · Los fragmentos de audio del candidato sonaban desfasados (rama `feat/audio-en-informes`)

- **Qué pasaba:** en la primera llamada real con grabación, el botón de una cita hacía sonar otra cosa: el final de la frase del candidato, un silencio y el comienzo de la respuesta del cliente.
- **Por qué:** el comienzo del turno del candidato se marcaba con el primer texto de su transcripción, menos 1,5 segundos. Se suponía que Gemini Live manda el texto mientras la persona habla, pero lo manda cuando termina. Todos los turnos del candidato quedaban de unos 2 segundos, al final de lo que había dicho (la cita de 20 segundos estaba guardada de 128,1 a 130,4 y se había dicho entre 107 y 128). Los turnos del cliente estaban bien.
- **Cómo se confirmó:** se decodificó la grabación con Chromium y se midió el volumen cada medio segundo: había voz continua justo antes del tramo guardado.
- **Qué cambió (`cronometroDeTurnos` en `core.js`):** el turno del candidato empieza donde terminó el turno anterior y termina cuando llega su último texto (lo que sigue es la espera hasta que contesta el cliente). Se sacó `ANTICIPO_SEG`. Si interrumpe al cliente, empieza con su primer texto.
- **Por qué no lo detectaron las pruebas:** el Gemini simulado mandaba el texto del candidato al empezar a hablar, al revés que el real. Ahora lo manda al final y la prueba comprueba que el turno empieza donde terminó el anterior.
- **El informe de esa primera llamada** (`d242cf92…`) se recalculó con la regla nueva; el original quedó en `data/logs/informe-d242cf92-antes-de-recalcular.json` (carpeta que git ignora).
- **Estado:** `npm test` pasa 254 de 254 y `npm run test:e2e`, 48 de 48, en WSL y en Windows.

### 2026-11-11 · Fragmentos de audio en el informe (rama `feat/audio-en-informes`)

- **Para qué:** que quien lee el informe pueda escuchar el momento de la llamada que el evaluador cita como evidencia, en vez de quedarse solo con el texto.
- **Qué hay:**
  - En el brief, con Gemini Live, una casilla sin marcar para aceptar la grabación. El texto dice qué se graba, para qué, quién lo escucha y que se borra a los 90 días; si no acepta, todo funciona igual sin audio.
  - Si acepta, se graban su voz y la del cliente en un solo archivo comprimido y la pantalla de la llamada dice "Grabando".
  - En el informe, un botón junto a cada cita que se pudo ubicar en un turno hablado del candidato: suena ese turno con un segundo de margen. Lo escuchan el candidato y la empresa.
- **Decisiones:**
  - Se guarda el audio completo una sola vez y los tiempos de cada turno; no se cortan fragmentos. Los tiempos los calcula la app con los eventos del motor de voz: no se le piden a la IA, que los inventaría.
  - No se usa `<audio>` para reproducir: las grabaciones del navegador no traen duración ni índice. Se decodifica el archivo y se toca el tramo exacto (unos 19 MB de memoria por cada 5 minutos mientras se escucha, que se liberan al salir).
  - La precisión es de turno entero, no de palabra.
  - Consentimiento (Ley 25.326): casilla sin marcar, se puede decir que no, y en el informe queda el texto que leyó, su versión, si aceptó y la fecha puesta por el servidor. El servidor no guarda un audio si en el informe no consta la aceptación.
  - Solo graba con Gemini Live. Con Vapi no se puede tomar el audio y con la voz del navegador no se puede grabar la voz del cliente.
  - Mientras suena el teléfono no se graba; con el micrófono silenciado no se graba la voz del candidato; una llamada demasiado corta (sin informe) no deja ninguna grabación.
  - El audio va por una ruta aparte, como archivo, no dentro del JSON del informe: en base64 pesaría un tercio más y pasaría el límite de 4 MB.
- **Lo que se encontró con las pruebas de concepto:** si se cierra el contexto de audio sin frenar antes la grabadora, se pierde el último medio segundo y la grabadora queda colgada. Por eso el motor la frena antes de cerrar.
- **Además:** se corrió `npm audit fix` (0 avisos) en un commit aparte, en `feat/exportar-informes`.
- **Falta:**
  - Probarlo con voz real: las pruebas usan el Gemini simulado y un micrófono de prueba. Hay que hacer una llamada real y escuchar un par de fragmentos. (La primera llamada real mostró que los tiempos del candidato estaban mal: ver la entrada del 2026-11-11 sobre los fragmentos desfasados.)
  - Que un abogado revise el texto de la casilla antes de usar la app con candidatos reales.
  - Los informes anteriores a este cambio no tienen audio ni tiempos: se ven como siempre, sin botones.
- **Estado:** `npm test` pasa 252 de 252 y `npm run test:e2e`, 48 de 48, en WSL y en Windows.

### 2026-11-11 · Exportar el listado de informes a Excel y PDF (rama `feat/exportar-informes`)

- **Qué hay:** en "Informes" de la empresa, dos botones (Excel y PDF) bajan lo que está filtrado en pantalla, con las columnas Simulación, Candidato, Fecha, Nota (0 a 100) y Duración. Mientras se genera, los botones se apagan y un aviso dice "Generando…"; al terminar dice cuántos informes lleva el archivo.
- **Excel:** la fecha es una fecha, la nota un número y la duración un tiempo (`m:ss`), así se pueden ordenar y promediar. El encabezado queda fijo y con el filtro de Excel. Una segunda hoja, "Exportación", dice la empresa, cuándo se generó y con qué filtros.
- **PDF:** A4, con el encabezado de la tabla repetido en cada página, los filtros arriba y "Página X de Y" abajo.
- **Arquitectura:** obtener los datos, convertirlos en filas y generar el archivo son tres piezas separadas (en `backend/src/modules/simulaciones/`: `repositories/informes-archivos.repository.js`, `informes/dto.js` y `exportar/`). Cuando los informes pasen a PostgreSQL cambia solo el repositorio.
- **Decisiones:**
  - `pdfmake` 0.3.14, que exige Node 20: el mínimo del proyecto subió de 18 a 20 (`engines`).
  - `exceljs` 4.4.0 con `overrides` en `package.json` para que use `uuid` 11. `npm audit` marcaba un aviso por el `uuid` 8 que trae exceljs; la versión de exceljs sin el aviso es la 3.4.0, de 2019, demasiado vieja. Con el `overrides`, las dos librerías nuevas no suman ningún aviso. exceljs usa `uuid` en un solo archivo y solo la función `v4`.
  - Tope de 5.000 informes por archivo; con más, pide achicar el rango.
  - Las librerías se cargan recién al exportar. Si no están instaladas, el error dice que hay que correr `npm install`.
  - Un nombre que empieza con `=` queda como texto en el Excel, no como fórmula (hay una prueba).
- **Errores que aparecieron y se corrigieron:**
  - En Windows, pdfmake no podía leer sus propias tipografías: la regla de acceso comparaba rutas con las barras mezcladas. Solo se vio al correr las pruebas con el Node de Windows.
  - En el PDF, la fecha y el título "Nota (0 a 100)" se partían en dos líneas: esas columnas ahora tienen ancho fijo.
  - El botón cambiaba su texto a "Generando…" y, al ser más largo, movía la barra de lugar: ahora el aviso va en el cartel de abajo.
- **Para saber:**
  - En WSL, la primera exportación a Excel después de arrancar el servidor tarda unos 35 segundos, por lo lento que es leer `node_modules` en `/mnt/c`. En Windows tarda medio segundo.
  - `npm audit` marcaba 5 avisos (3 moderados y 2 altos) que ya estaban antes de este cambio: eran de paquetes que usa por dentro el Agent SDK de Claude (`@modelcontextprotocol/sdk`: `express`, `hono`, `zod`, `ajv`). Se corrió `npm audit fix` con el npm de Windows: actualizó 5 paquetes internos (`@hono/node-server`, `body-parser`, `fast-uri`, `qs` y `zod`, todos cambios menores), sin tocar las dependencias directas. `npm audit` da 0 avisos y las pruebas pasan igual en los dos sistemas. No se probó contra la IA real (`npm run chequeo`), que gasta cuota.
- **Estado:** `npm test` pasa 212 de 212 y `npm run test:e2e`, 43 de 43, en WSL y en Windows.

### 2026-11-11 · La prueba de interrumpir al cliente usa una voz simulada (rama `feat/filtros-informes`)

- **Qué pasaba:** en WSL fallaba "interrumpir al cliente lo corta y pasa a escuchar". El Chromium de Linux no trae voces de síntesis (`speechSynthesis` da `synthesis-failed`), así que el cliente nunca llegaba a estar "hablando".
- **Qué se hizo:** la prueba reemplaza la voz del navegador por una simulada (`vozSimuladaEn` en `test/helpers.mjs`): no suena, pero cada frase arranca, dura según su largo y termina, o se corta con `cancel()`. Al terminar se vuelve a la voz real, para que las demás pruebas corran como siempre.
- **Lo que apareció al hacerlo:** la prueba vieja pasaba sin probar la interrupción. La esfera late mientras el cliente habla y Playwright espera a que un elemento se quede quieto antes de hacer clic: el clic tardaba 6 segundos y llegaba cuando el cliente ya había terminado de hablar solo. Como la prueba solo miraba que al final dijera "Te escucho", daba bien igual. Ahora el clic va con `force` y la prueba comprueba, con el registro de la voz simulada, que el cliente estaba hablando y que la voz se cortó una vez.
- **La app no cambió:** la interrupción funcionaba; lo que estaba mal era la prueba.
- **Estado:** `npm test` pasa 183 de 183 y `npm run test:e2e`, 42 de 42, en WSL y en Windows.

### 2026-11-11 · Filtros en las listas de informes (rama `feat/filtros-informes`)

- **Qué hay:** "Mis informes" (candidato) e "Informes" (empresa) tienen una barra de filtros: Desde, Hasta, Simulación y, solo para la empresa, Candidato (se escribe y sugiere nombres), más un botón Limpiar. Los filtros siguen puestos al volver de un informe y se borran al salir de la cuenta.
- **Dónde se filtra:** en el servidor. La lista sale de un repositorio (`backend/src/modules/simulaciones/repositories/informes-archivos.repository.js`) que recibe el filtro y el alcance de quien pregunta. Es la pieza que se cambia el día que los informes pasen a PostgreSQL; `filtro.js` y el resto del servidor quedan igual.
- **Decisiones:**
  - Las fechas viajan como instantes exactos, no como días: el navegador calcula el comienzo del día en la hora de la persona. Si viajara el día, "hasta el 10" cortaría 3 horas antes en Argentina.
  - El alcance mal armado no ve nada (`{}` o un `usuarioId` vacío): un descuido en el servidor nunca abre la lista completa.
  - El filtro por empresa, que estaba en el navegador, pasó al servidor. "Mis informes" ya no filtra por nombre en el navegador: el servidor filtra por usuario, y dos personas con el mismo nombre no se mezclan.
  - Las opciones de los desplegables no se achican con los otros filtros: si no, al elegir una simulación desaparecerían las demás.
  - El resumen de la lista suma `duracionSeg` (lo necesita la exportación).
  - Al entrar, solo el candidato pide sus informes (los usa el inicio); la empresa pide su lista al abrir Informes. Antes se pedían dos veces.
- **Además:** los archivos estáticos rechazan cualquier ruta con `\` (antes, `/..\.env` daba 403 en Windows y 404 en Linux), y en WSL quedó instalado el Chromium que usa el Playwright del proyecto (`node node_modules/playwright/cli.js install chromium`, desde la carpeta del proyecto: con `npx` desde otra carpeta se baja otra versión).
- **Limitación:** el repositorio de archivos lee todos los JSON en cada pedido, igual que antes. Se resuelve con la base de datos.
- **Estado:** `npm test` pasa 183 de 183 (en WSL y en Windows) y `npm run test:e2e`, 42 de 42 en Windows y 41 de 42 en WSL. La que fallaba en WSL era la de interrumpir al cliente: ver la entrada de arriba.

### 2026-11-11 · "Lo que tenés a mano" durante la llamada (rama `feat/ficha-en-llamada`)

- **Qué pasaba:** el candidato leía la `ficha` en el brief y, al empezar la llamada, desaparecía. Datos como el monto, el DNI o el número de gestión no se retienen leyéndolos una vez.
- **Qué hay:** un botón más en los controles de la llamada (solo si el escenario tiene `ficha`) que abre un panel con los mismos datos del brief y un botón para copiar cada uno. Se cierra con el mismo botón, con la X o con Esc. Mientras suena el teléfono no se muestra. Si el candidato lo deja abierto, la próxima llamada arranca abierto.
- **Opciones que se evaluaron:** un panel desplegable (el elegido: sigue el patrón de los botones de teclado y transcripción y no tapa la esfera), tarjetas fijas (no entran en el celular) y un widget flotante que se arrastra (tapa la interfaz y es difícil de usar con teclado).
- **Cuidado:** en el celular, la hoja tapa el botón Colgar mientras está abierta.
- **Además:** la prueba de la cobranza en `e2e.test.mjs` había quedado vieja desde que en las salientes el operador dice los datos: esperaba que el brief no mostrara el DNI. Ahora verifica que la saliente lo muestra y la entrante no.
- **Estado:** `npm test` pasa 155 de 155 y `npm run test:e2e`, 39 de 39 (con el Node de Windows: en WSL no está instalado el navegador de Playwright y una prueba de rutas con `\` da distinto en Linux).
- **Lo que sigue (plan aprobado):** filtros en los informes, exportación a Excel y PDF (`exceljs` y `pdfmake`) y fragmentos de audio en el informe (con una casilla de consentimiento sin marcar, el registro de la aceptación en el informe, el audio guardado 90 días y escuchable también por el candidato).

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

### 2026-10-29 · Guion de cobranza, indicadores de MKT y calibración del evaluador (rama `feat/calibrar-mkt`)

- **Qué pasaba:** las simulaciones de cobranza daban entre 17 y 38 puntos. Parte eran errores reales (hablar de la deuda antes de validar, no decir el monto de cada cuota). La otra parte venía de que la campaña no tenía guion: pasos normales de una cobranza, como pedir el "sí, acepto" al final o los medios de pago, el evaluador los contaba como "le hizo repetir datos" o "inventó condiciones".
- **Qué se hizo:**
  - Procedimiento nuevo `p-cobranza` (el guion de 9 pasos) y la `ficha` de la cobranza con todo lo que hace falta: cuotas sin interés, primera cuota dentro de los 30 días, medios de pago, lectura del acuerdo con el "sí, acepto", dictado del número y cierre.
  - Indicadores (`cuenta` / `noCuenta`) para los 6 criterios de MKT, y una aclaración en `notasEvaluacion`: validar la identidad y pedir el "sí, acepto" no cuentan como hacer repetir datos, y el saludo no tiene que ser textual.
  - `evals/calibracion-mkt/`: 5 cobranzas sintéticas de excelente a falla de compliance.
  - `data/empresa.json` era idéntico al ejemplo de MKT anterior: se actualizó con el nuevo (había una copia de seguridad en el scratchpad de la sesión).
- **La frase "se reemplaza cuando MKT nos cuente una real"** es solo un comentario: no cambia ningún criterio. ConectAR (internet y TV) es una campaña típica de un contact center, así que no se recreó el escenario.
- **Resultados (3 corridas, `evals/resultados/20261029-165117/`):** excelente 74 (71-79), bueno 54, mediocre 28, malo 7 y falla de compliance 1. El orden es correcto y estable. El golden set de MKT (`20261029-165457/`) queda igual que antes, así que los otros escenarios no se rompieron.
- **Estado:** `npm test` pasa 153 de 153.

### 2026-10-29 · En las llamadas salientes no se le piden datos al cliente (rama `feat/calibrar-mkt`)

- **Qué pasaba:** en la cobranza, el operador le pedía a Diego el DNI y la fecha de nacimiento. En una llamada saliente el cliente no sabe quién lo llama: darle esos datos a un desconocido es justamente lo que buscan las estafas, y no se le debe enseñar a un operador a pedirlos.
- **Qué cambió (solo salientes; en las entrantes el cliente llamó él y se le siguen pidiendo los datos):**
  - El operador le dice el DNI y la fecha de nacimiento que figuran en el sistema y el cliente confirma. Está en el contexto (`trabajo`, `problemas`), en una restricción nueva, en el paso 2 del guion `p-cobranza` y en la `ficha` de la cobranza, que ahora muestra el DNI y la fecha.
  - Diego desconfía si se los piden ("¿y vos quién sos?") y no los da.
  - Procedimiento tiene un indicador nuevo en contra: pedirle datos personales al cliente en una llamada saliente.
  - Las llamadas de calibración 01 a 04 validan de la forma nueva, y hay un caso nuevo, `06_pide_datos`.
- **Advertencia:** si atiende otra persona, escucha los datos completos. La alternativa es decir solo una parte ("tu DNI termina en 004…"); el usuario eligió los datos completos.
- **Resultados (`evals/resultados/20261029-235040/`, 2 corridas):** excelente 87, bueno 63, mediocre 42, malo 9, falla de compliance 3. El caso que pide los datos saca 80: el evaluador detecta el error y baja Procedimiento a 3, pero no a 1 o 2, porque el operador se corrigió enseguida y el cliente no dio nada. Si MKT lo considera una falta grave aunque se corrija, hay que decirlo en el indicador.
- **Estado:** `npm test` pasa 155 de 155.

### 2026-10-29 · Escala nueva del puntaje y el cliente ya no corta antes del cierre (rama `feat/calibrar-mkt`)

- **Escala:** siguiendo el guion, una cobranza sacaba 55, y un 55/100 se lee como un fracaso aunque la persona lo haya hecho bien. El 3 del evaluador significa "cumple, lo hace bien", pero valía 50. Ahora cada nivel vale 1 = 0, 2 = 35, 3 = 65, 4 = 85, 5 = 100 (`VALOR_NIVEL` en `core.js`). Lo que se evalúa no cambia, solo cómo se lee el número. Con las corridas de calibración, la excelente pasa de 74 a 84 y la bien hecha, de 54 a 67; las malas casi no cambian (de 7 a 10 y de 1 a 2). Se actualizaron los rangos de `evals/calibracion-mkt/`. Los rangos de `evals/transcripciones/` (Nodo) eran para la escala anterior y falta revisarlos. Los informes ya guardados conservan el puntaje con el que se crearon. **Falta que RR. HH. lo confirme.**
- **El cliente cortaba antes del cierre:** en las dos cobranzas de prueba, Diego se despedía apenas decía "sí, acepto", porque la regla del escenario era "se resuelve cuando hay un acuerdo de pago con fecha". El candidato no llegaba a dar el número de gestión ni a preguntar si había algo más, y el evaluador le bajaba Cierre o lo dejaba sin puntaje. Ahora la cobranza se resuelve cuando además se dio el número (si no se lo dan, Diego lo pide), y la consigna de voz de todos los clientes dice que, al aceptar un acuerdo, no se despidan en esa misma respuesta. Falta probarlo con la voz real.
- **Estado:** `npm test` pasa 154 de 154 y `npm run test:e2e`, 38 de 38 (con la escala nueva, el informe de prueba da 81 en lugar de 71).

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
