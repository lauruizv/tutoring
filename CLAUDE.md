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

**Proveedores de IA.** Hay tres, configurados por `.env`:
- `claude-sdk`: el Claude Agent SDK (Claude Code con la suscripción de la máquina), usado solo como modelo de texto, sin herramientas y en un directorio vacío (`opcionesSdk`).
- `anthropic`: la API de Anthropic por `fetch` directo, no con `@anthropic-ai/sdk`.
- `gemini`: por su endpoint compatible con OpenAI.

`LEEME.md` dice que el proveedor por defecto es `gemini`, pero en el código es `claude-sdk` (`PRIMARY`). El flujo general es `responder()` → `conReintentos()` → `intentar()` → `RUN[id]`, con backoff y paso al proveedor de respaldo según el código de error (`esReintentable`, `pasaAlRespaldo`).

**La evaluación tiene un camino propio (`responderEval`).** Usa su propia cadena (`EVAL_CADENA`, configurable con `LLM_EVAL_CADENA`). Hace una "carrera" (`carreraEval`): si `claude-sdk` no termina en `EVAL_CARRERA_MS`, lanza un segundo intento en paralelo y gana el primer informe válido. El texto no se transmite a medida que llega: `intentar` lo acumula, lo valida con `core.parseEvaluacion` y lo entrega completo. Para Gemini fuerza el JSON con `EVAL_SCHEMA`; si cambiás los campos del informe, actualizá ese esquema, el prompt y el parseo a la vez.

**Código compartido entre navegador y Node.** `public/js/core.js` es UMD: el servidor y los tests lo importan con `require`, y el navegador lo expone en `window.T.core`. Contiene la lógica pura: historial, `extraerJSON`/`parseEvaluacion`, `puntajeCriterio`/`puntajePonderado` (puntaje de 0 a 100 a partir de criterios de 1 a 5, con `VALOR_NIVEL`: 1 = 0, 2 = 35, 3 = 65, 4 = 85, 5 = 100; los criterios en `null` quedan fuera) y la migración de la configuración. `prompts.js` y `defaults.js` solo existen en el navegador (`window.T.prompts`, `T.DEFAULTS`). Cuando Node necesita esos archivos, los carga en un contexto `vm` (ver `evals/puente.mjs`).

**Frontend (`public/js/app.js`).** Es una SPA sin framework: `VIEWS[nombre]`, `go()` y el estado en `S`. Al arrancar, `boot()` → `entrar()` pide `/api/yo`; sin sesión muestra `VIEWS.login` (`body.sin-sesion` oculta la barra lateral). El perfil sale del rol de la sesión: ya no hay selector de perfil ni campo de nombre. Cada rol tiene su pantalla de inicio (`INICIO`) y su color (`body[data-rol]`). El `localStorage` se separa por usuario (`k()`). Un 401 `sin_ingreso` en cualquier pedido lleva al ingreso con aviso (`T.api.onSinSesion`). Hay tres perfiles: estudiante (se muestra como "Candidato": simulación por voz e informe), junior (chat con el mentor) y empresa (configura contexto, escenarios y criterios, y ve los informes). El informe se arma en el navegador (`runEvaluation`): prompt de `T.prompts.evaluacion`, `purpose: "eval"`, parseo y puntaje con `core`, y después `POST /api/informes`. El servidor guarda el informe sin tocarlo. Candidato y empresa ven la misma vista (`VIEWS.report`).

**Quién arranca la llamada.** El campo `inicio` del escenario define quién habla primero: sin el campo, el cliente (como siempre); `"atiende"` (llamada entrante: `vozInicio` devuelve `null` y los tres motores esperan a que hable el candidato); `"llama"` (llamada saliente: el cliente atiende solo con "¿Hola?"). El prompt de voz y el de evaluación lo mencionan solo si el campo está, así los escenarios viejos no cambian.

**Voz (`public/js/voice.js`).** Tres motores con la misma interfaz: `gemini-live` (por defecto, voz a voz por WebSocket directo a Google con un token efímero de `/api/voz/token`), `vapi` y `browser`. La transcripción que generan es la que después se evalúa.

**Por qué Gemini Live no pasa por el backend.** El navegador abre el WebSocket directo a Google (el servidor solo mintea el token efímero: un uso, ~30 min, atado al modelo). Así el audio no hace el salto extra navegador → server → Google, que en voz a voz se nota en la latencia; la `GEMINI_API_KEY` no sale del servidor y el servidor no sostiene un WebSocket de audio por llamada. El costo: el backend no ve nada de la llamada. Si hace falta verlo, el navegador lo reporta (ver tokens abajo) o habría que hacer un proxy WebSocket en el backend (ve todo y da números exactos, pero suma latencia y carga; no se hizo).

**Tokens de la llamada de voz (Gemini Live).** `voice.js` suma el `usageMetadata` que Google manda una vez por turno (`promptTokenCount` ya incluye todo el contexto de ese turno; se asume que cada turno se cobra entero, sin verificar todavía contra la facturación de Google; las sesiones renovadas también cuentan) y, al colgar (`liberar()` → `informarUso()`), hace `POST /api/voz/uso` con `fetch` `keepalive`. `voz.service.registrarUso` escribe una línea `[VOZ] gemini-live · modelo · llamada · Ns · usuario=… · N turnos · tokens in=… (texto/audio) out=… (audio/texto) pensamiento=…` en la terminal y en `data/logs/ia-AAAA-MM-DD.log` (el mismo archivo del log de la IA). Límites: si cierran la pestaña de golpe el reporte puede perderse, y un navegador modificado podría mandar números falsos, así que sirve para ver consumo, no como facturación confiable. Los tokens de pensamiento se cobran como salida.

**Costos en el log.** `backend/src/shared/utils/precios.js` tiene los precios hardcodeados de Gemini Live y Claude (por millón de tokens) y calcula el costo: la línea `[VOZ]` suma `costo=US$…` y `logIA` agrega el costo a cada consulta a Claude, incluidos los intentos fallidos de la evaluación. Con `claude-sdk` figura como "costo equivalente por API", porque la suscripción no paga por token. Los modelos sin precio cargado (hoy, el Gemini de texto de respaldo) salen sin costo. `npm run costos [-- archivo.log] [-- --solo-resumen]` completa un log viejo (deja `.bak`) y muestra los totales. Supuestos: pensamiento a la tarifa de salida de texto, el alias `sonnet` = `claude-sonnet-5-5`, `haiku` = `claude-haiku-5-5` y caché de 5 minutos (escribir 1,25x, leer 0,1x). Si la key de Gemini está en el plan gratuito, la voz no se paga: el número es lo que costaría en el plan pago.

**Costo de una simulación completa.** Cuando están la llamada y su informe, el log suma una línea `[SIM] #pedido simulación · llamada US$… + informe US$… = total US$…`. El navegador genera un id por llamada (`S.simulacion` en `VIEWS.call`) y lo manda en `/api/voz/uso` y en la evaluación (`simulacion`, no llega al proveedor); `shared/utils/costo-simulacion.js` los une en memoria, en cualquier orden, y dos horas después descarta lo que quedó sin par. El informe suma todos sus intentos con tokens, incluidos los fallidos y los del Reintentar; un intento cancelado no informa tokens y no suma. Una llamada sin informe (muy corta) no tiene línea `[SIM]`, y tampoco los motores `vapi` y `browser`, que no informan tokens. `npm run costos` agrega `[SIM]` a logs viejos uniendo por hora (±5 s).

**Llamada por teléfono (`VIEWS.call` en `app.js`).** En los escenarios por teléfono con un cliente (no en persona ni con el líder) suena un timbre (`T.voice.tono`, generado con Web Audio) y el candidato toca **Atender**; mientras suena, la pantalla muestra solo ese botón, al centro (`.call.sonando`). Si `inicio` es `"atiende"`, el motor conecta mientras suena, con el micrófono silenciado, y el botón se habilita cuando la voz está lista. Si habla primero el cliente, el motor arranca al atender. En las salientes (`"llama"`) el candidato toca **Llamar** y suena el tono de llamada hasta que el cliente empieza a hablar. Con la voz telefónica, al conectarse suena un ruido de línea suave de fondo (`T.voice.linea`). Con Gemini Live, la voz del cliente pasa por un filtro telefónico (`telefono()` en `voice.js`) salvo que `cfg.vozTelefonica` sea `false`. El acento rioplatense lo sostiene la sección "TU ACENTO" de `prompts.js` y la renovación de la sesión de Gemini Live cada 2 minutos (`quizasRenovar` en `voice.js`, en un silencio y sin corte); describe el sonido sin escribir las palabras como suenan, porque si no la transcripción sale con "sho" (`core.textoHablable` corrige lo que se cuele). Antes de la llamada, el brief tiene una prueba de audio (`pruebaDeAudio` en `app.js`): micrófono, salida, nivel y sonido de prueba; lo elegido queda en `S.audio` y lo usa Gemini Live. Lo que la vista deja abierto se cierra en `render()` con `S.alSalirDeVista`. Si el escenario tiene `ficha`, durante la llamada un botón abre "Lo que tenés a mano" (`.ficha-panel`: columna a la derecha; en pantallas chicas, hoja desde abajo), con un botón para copiar cada dato. Se cierra con Esc y queda abierto o cerrado por usuario (`k("fichaAbierta")`). El brief y la llamada arman la lista con las mismas funciones (`fichaItems` y `fichaLista`).

**Caché de prompts.** El prompt del mentor está ordenado para que la parte estable vaya primero (`system_estable` indica hasta dónde). `test/prompts.test.mjs` compara contra `test/fixtures/prompts-antes.js` que el texto que recibe el modelo no cambie. Si modificás `prompts.js` a propósito, actualizá ese fixture.

## Tests

- Ningún test usa la API real. `test/helpers.mjs` (`startApp`) arranca `backend/server.js` en un proceso aparte, con `DATA_DIR` temporal y las URLs de los proveedores apuntando a `test/fake-llm.mjs`.
- El Agent SDK se reemplaza con `CLAUDE_SDK_MODULE` (por ejemplo, `test/fake-sdk-*.mjs`).
- `startApp` siembra usuarios (`estudiante1`, `estudiante2`, `junior1`, `empresa1`, con clave `clave-de-prueba`, y `nuevo1`, que entra con `app.codigoNuevo`) y entra como `empresa1`. `pedir()` y `pedirMensajes()` mandan esa cookie salvo `{ cookie: null }` u otra. En Playwright se usa `ingresarEn(page, base, usuario)` y `salirEn(page)`.
- Cuando agregues una variable de entorno que lea el servidor, neutralizala en `startApp` para que no se filtre el `.env` real.

## Evals (`evals/`)

Hoy hay 5 casos sintéticos, todos del escenario `incidente-viernes` de Nodo, con rangos esperados que todavía no revisó RRHH. Para tener un golden set hacen falta entre 40 y 50 casos puntuados a mano por una licenciada en RRHH, la mayoría conversaciones reales de un piloto.

`evals/golden-mkt/` tiene 9 casos sintéticos de los escenarios de call center (empresa de ejemplo `mkt` en `defaults.js`, borrador en `docs/escenarios-mkt.md`) con `esperado: null`. El rango esperado lo decide RR. HH. con `planilla-rrhh.csv` (dos personas por caso), nunca quien escribió los casos ni la IA. `test/mkt.test.mjs` verifica que los casos coincidan con los escenarios.

`evals/calibracion-mkt/` tiene 5 conversaciones sintéticas de la cobranza de MKT, de excelente a falla de compliance, con rangos esperados provisorios puestos por nosotros. Sirven para comprobar que el evaluador ordena bien las llamadas y que seguir el guion de la campaña (`p-cobranza` y la `ficha`) da un puntaje alto. No reemplazan al golden set.

`run_evals.py` corre las transcripciones de `evals/transcripciones/*.json` por el evaluador real. No reimplementa nada: delega en `puente.mjs`, que usa el mismo prompt, el mismo `system` y el mismo `max_tokens` que `app.js` (los lee del código fuente) y el `POST /api/messages` de un servidor levantado. Cada caso trae los rangos esperados por criterio en `esperado`. Los resultados van a `evals/resultados/<AAAAMMDD-HHMMSS>/` (`resumen.csv`, `criterios.csv`, `corridas.csv`, `crudo.jsonl`).

## Bitácora

Registro paso a paso de los cambios del programa: qué se decidió, por qué y dónde está el detalle. Se actualiza en cada paso, con el más nuevo arriba. Cuando algo se implementa, se describe también en la sección de arquitectura que corresponda.

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
