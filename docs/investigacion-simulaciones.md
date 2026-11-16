# Precisión de las simulaciones, golden evals y datos a registrar

Documento para el equipo técnico. Junta lo que se investigó y se probó sobre tres pedidos: cómo hacer más precisa la herramienta de simulaciones, cómo conseguir las evaluaciones de referencia (golden evals) y qué otra información conviene registrar. Los números salen de corridas reales del evaluador, guardadas en `evals/resultados/`; el detalle de cada cambio está en la bitácora de `CLAUDE.md`.

Fecha: 2026-11-16.

## Resumen

- **Precisión:** lo que más movió el puntaje no fue el modelo ni el prompt del evaluador, sino darle al evaluador y al candidato la misma información que tiene un operador real: el guion de la campaña y los datos del sistema. Sin eso, el evaluador castigaba pasos correctos.
- **Golden evals:** el método está definido y hay 9 casos sintéticos listos para puntuar. Lo que falta no es código: es que RR. HH. puntúe, y sumar conversaciones reales.
- **Datos:** el informe ya guarda los datos de la llamada (flujo, ayudas usadas, datos técnicos). Quedan tres grupos propuestos sin implementar y un hueco en el esquema de Postgres.

## 1. Precisión de las simulaciones

"Precisión" son dos cosas distintas, y conviene no mezclarlas:

- **Que la simulación se parezca a una llamada real** (el cliente, la voz, el arranque).
- **Que el puntaje refleje lo que haría una persona de RR. HH.** con la misma llamada.

### 1.1 Qué se cambió en el evaluador y qué resultado dio

El punto de partida: las simulaciones de cobranza daban entre 17 y 38 puntos, aun cuando el operador hacía una llamada razonable.

| Cambio | Por qué | Efecto medido |
|---|---|---|
| Guion de la campaña (`p-cobranza`, 9 pasos) y `ficha` del escenario | Sin guion, el evaluador contaba pasos normales como errores: pedir el "sí, acepto" era "hacer repetir datos" y decir los medios de pago, "inventar condiciones" | La llamada excelente pasó a 74 y la bien hecha a 54 (3 corridas, `20261029-165117`) |
| Indicadores por criterio (`cuenta` / `noCuenta`) y aclaraciones en `notasEvaluacion` | El criterio solo, sin ejemplos de qué cuenta y qué no, deja mucho a la interpretación del modelo | Mismo resultado de arriba; el orden de las llamadas quedó estable entre corridas |
| En las salientes, el operador dice los datos y el cliente confirma | Pedirle el DNI a quien no llamó es lo que hace una estafa: no hay que entrenarlo ni premiarlo | Excelente 87, bueno 63, mediocre 42, malo 9, falla de compliance 3 (2 corridas, `20261029-235040`) |
| Escala nueva del puntaje (`VALOR_NIVEL`: 1 = 0, 2 = 35, 3 = 65, 4 = 85, 5 = 100) | El 3 del evaluador significa "cumple, lo hace bien", pero valía 50: una llamada correcta se leía como un fracaso | Con las mismas respuestas del evaluador, la excelente pasa de 74 a 84 y la bien hecha de 54 a 67; las malas casi no se mueven |
| El cliente no corta apenas acepta el acuerdo | El candidato no llegaba a dar el número de gestión ni a cerrar, y perdía puntos de Cierre por algo que no dependía de él | Sin medición propia; falta verlo con voz real |

Lo que se puede afirmar con estos datos: el evaluador **ordena bien** las seis llamadas de `evals/calibracion-mkt/` (de excelente a falla de compliance) y el orden se repite entre corridas. Lo que no se puede afirmar: que el número coincida con el de RR. HH. Los rangos esperados de esa carpeta los pusimos nosotros.

Un caso para discutir con MKT: `06_pide_datos` (buena llamada, pero le pide los datos al cliente en una saliente) saca 80. El evaluador detecta el error y baja Procedimiento a 3, no a 1 o 2, porque el operador se corrige enseguida. Si para MKT es una falta grave aunque se corrija, hay que decirlo en el indicador.

### 1.2 Qué se cambió en la simulación

- **Quién arranca la llamada** (`inicio` del escenario): en las entrantes saluda el candidato. Antes arrancaba siempre la IA y el saludo y la validación de identidad no se podían observar.
- **Lo que el operador tiene a mano** (`ficha`): en el brief y durante la llamada. Antes se evaluaba al candidato por datos que no tenía forma de saber.
- **Acento:** la sesión de Gemini Live se renueva cada 2 minutos en un silencio. Con minutos de audio acumulado, la voz volvía a su tonada neutra aunque las palabras siguieran siendo argentinas, y reforzar la consigna no alcanzaba.
- **Transcripción:** la consigna del acento describe el sonido sin escribir las palabras como suenan; si no, la transcripción salía con "sho" y eso es lo que después lee el evaluador.
- **Llamada telefónica:** timbre, botón Atender o Llamar, filtro de voz y ruido de línea.

### 1.3 Lo que se probó y no sirvió

**Medir el tono de voz con Gemini Live.** Se generó la misma frase neutra con voz amable y con voz agresiva, tres veces por combinación.

- Con el modelo de la app (`gemini-3.8-live`) y sin consigna, el cliente no reaccionó nunca al tono.
- Con una consigna que le pide fijarse en el tono, reaccionó 1 de 3 veces al tono agresivo y también 1 de 3 al amable: no distingue.
- El "diálogo afectivo" (`enableAffectiveDialog`) solo lo soporta `gemini-2.5-flash-native-audio-latest`; en el modelo de la app corta la sesión con error 1007. No se activó.

Conclusión: hoy el tono de voz no se puede medir de forma confiable. El maltrato en las palabras sí lo ve el evaluador, porque trabaja sobre la transcripción.

### 1.4 Límites conocidos

- **El evaluador lee texto, no escucha.** Todo lo que sea tono, ritmo o volumen queda afuera.
- **La evaluación se arma en el navegador.** Un candidato con conocimientos técnicos puede ver la consigna o alterar su puntaje. Está anotado como pendiente pasar el armado del prompt y la evaluación al servidor.
- **Los casos de calibración son sintéticos.** Las conversaciones escritas a mano son más prolijas que las reales.
- **Los rangos de `evals/transcripciones/` (Nodo)** se pensaron para la escala anterior y no se revisaron.

### 1.5 Qué seguiría, en orden

1. **Golden set puntuado por RR. HH.** (sección 2). Sin eso, cualquier ajuste del evaluador se valida contra nuestra propia opinión.
2. **Pasos del guion cumplidos** (sección 3.3, grupo E): que el evaluador devuelva, además del puntaje, qué pasos hizo el operador. Es más verificable que un puntaje de 1 a 5 y se puede comparar contra una lista.
3. **Evaluación en el servidor**, para que el puntaje no dependa del navegador.
4. **Correr cada evaluación más de una vez** en los casos cerca de un límite de nivel, y mostrar el rango en vez de un solo número. Tiene costo: duplica o triplica las llamadas al modelo.

## 2. Golden evals

### 2.1 Qué son y para qué sirven

Un golden set es un conjunto de conversaciones con el puntaje que les pondría una persona experta, criterio por criterio. Sirve para responder con un número la pregunta "¿el evaluador puntúa como RR. HH.?", y para saber si un cambio en el prompt, en los criterios o en el modelo mejora o empeora.

La regla que no se negocia: **el puntaje esperado no lo pone quien escribió los casos ni la IA.** Si lo ponemos nosotros, el evaluador se compara contra nuestra opinión y siempre va a dar bien.

### 2.2 Qué hay hoy

| Carpeta | Casos | Rangos esperados | Para qué sirve |
|---|---|---|---|
| `evals/golden-mkt/` | 9 sintéticos, de los 6 escenarios de MKT | `null`, a propósito | Es el golden set en armado |
| `evals/calibracion-mkt/` | 6 sintéticos de cobranza | Provisorios, puestos por nosotros | Comprobar que ordena bien; no es un golden set |
| `evals/transcripciones/` | 5 sintéticos de Nodo | Para la escala vieja, sin revisar | Histórico |

Con los 9 casos de `golden-mkt` ya se corrió el evaluador (3 corridas, `20261027-205509`): los casos con buenas conductas dieron entre 42 y 54 y los malos entre 8 y 25, con la escala vieja. El caso que le pide al evaluador el puntaje máximo no logró subirlo.

Un problema a resolver antes de que RR. HH. puntúe: esas conversaciones son anteriores a la `ficha`. Hay números de gestión que no coinciden con los del escenario y una escalación "al supervisor" donde la ficha dice Soporte de nivel 2. El evaluador las cuenta como errores del operador. Hay que alinear las conversaciones con la ficha, o avisarle a RR. HH. para que no lo penalice.

### 2.3 Cómo se obtiene

1. **RR. HH. puntúa los 9 casos** con `evals/golden-mkt/planilla-rrhh.csv` (una fila por caso y criterio). Dos personas por caso, por separado, de 1 a 5 o `NO` si el criterio no se puede observar, con la frase que justifica el puntaje.
2. **Se juntan y acuerdan un rango** por criterio. Si estuvieron a 2 puntos o más, el problema suele ser la descripción del criterio, no las personas: se reescribe el criterio.
3. **El rango pasa al campo `esperado`** del JSON de cada caso.
4. **Se suman conversaciones reales** de un piloto, con consentimiento y sin datos personales, hasta llegar a 40 o 50 casos. La mayoría tienen que ser reales.

El paso 1 no necesita nada del equipo técnico: la planilla y las instrucciones para RR. HH. ya están en `evals/golden-mkt/LEEME.md`.

### 2.4 Cómo se corre y qué se mira

```
python evals/run_evals.py evals/golden-mkt -n 3 --levantar-servidor
```

`run_evals.py` no reimplementa nada: usa el mismo prompt, el mismo `system` y el mismo `max_tokens` que la app, a través de `evals/puente.mjs`. Los resultados quedan en `evals/resultados/<fecha>/` (`resumen.csv`, `criterios.csv`, `corridas.csv`, `crudo.jsonl`). Gasta cuota.

Qué mirar, de más simple a más fino:

- **Qué parte de los criterios cae dentro del rango acordado.** Es el número principal.
- **En cuáles criterios falla más.** Si un criterio falla en casi todos los casos, el problema es su descripción o sus indicadores.
- **Si falla por arriba o por abajo.** Un evaluador que siempre da de más es un problema distinto de uno que da de menos.
- **Cuánto varía entre corridas** del mismo caso. Si un criterio salta 2 niveles de una corrida a otra, no es confiable aunque el promedio dé bien.
- **El acuerdo entre las dos personas de RR. HH.** Es el techo: no se le puede pedir al evaluador que coincida con RR. HH. más de lo que RR. HH. coincide entre sí.

### 2.5 Propuesta de criterio de aceptación

A confirmar con el equipo y con RR. HH.; son números para empezar a discutir, no medidos:

- Al menos el 80 % de los criterios dentro del rango acordado.
- Ningún criterio a 2 niveles o más del rango en un caso de falla grave (compliance, maltrato).
- El orden de los casos por puntaje total, igual al de RR. HH. salvo empates.

### 2.6 Riesgos

- **Pocos casos.** Con 9, un solo caso mal puntuado mueve el resultado 11 puntos.
- **Ajustar el prompt mirando el golden set** hasta que dé bien. Conviene apartar una parte de los casos y no mirarla mientras se ajusta.
- **Conversaciones reales con datos personales.** Hay que anonimizarlas antes de guardarlas en el repo, y el consentimiento tiene que cubrir este uso.

## 3. Datos a registrar

### 3.1 Qué se guarda hoy

| Dato | Dónde | Desde |
|---|---|---|
| Transcripción turno por turno | Informe (JSON) | Siempre |
| Puntaje, y por criterio: nivel, evidencia y comentario | Informe | Siempre |
| Escenario y criterios como estaban al evaluar | Informe | Siempre |
| Duración de la llamada | Informe | Siempre |
| Segundos de cada turno (`t0`, `t1`) | Informe | Solo con grabación |
| Aceptación de la grabación: texto, versión, respuesta y fecha del servidor | Informe | Con la grabación |
| Audio de la llamada, 90 días | `DATA_DIR/audios/` | Con la grabación |
| Id y mail de quien hizo la simulación, id del escenario | Informe | 2026-11-16 |
| Datos de la llamada (`metricas`) | Informe | 2026-11-16 |
| Simulación con su precio | Postgres (`simulaciones`) | Solo cuentas que entran con Google |
| Costo en dólares de la voz y de la evaluación | Log del servidor | 2026-11-03 |

### 3.2 Lo que se sumó: datos de la llamada

Tres grupos, calculados en el navegador al terminar la llamada, sin IA y sin costo (`core.metricasDeLlamada`):

- **Flujo de la conversación:** turnos y palabras de cada lado, qué parte de lo dicho fue del candidato, su respuesta más larga, el tiempo de los turnos, cuántas veces interrumpió al cliente y quién cortó.
- **Uso de las ayudas:** cuántas veces abrió "Lo que tenés a mano" y cuántos datos copió, respuestas escritas con el teclado, veces que silenció el micrófono.
- **Datos técnicos:** motor de voz, si se grabó y avisos de error.

Los ve la empresa en el informe. No cambian el puntaje ni se le pasan al evaluador.

Dos cosas que se dejaron afuera a propósito:

- **Palabras por minuto.** El turno del candidato se mide desde que terminó el cliente, así que incluye la pausa de antes de contestar: el número daría más lento de lo real.
- **Intentos del evaluador.** Pasa en el servidor y el navegador no lo ve.

### 3.3 Propuestas sin implementar

| Grupo | Qué es | Qué hace falta | Cuándo conviene |
|---|---|---|---|
| D. Proceso del candidato | Número de intento en cada escenario, llamadas abandonadas sin informe, tiempo en el brief | Guardar en el servidor las llamadas que no llegan a informe; hoy no dejan rastro | Con la migración de informes a Postgres |
| E. Pasos del guion cumplidos | Qué pasos hizo y cuáles salteó (validó, dijo el monto, dio el número de gestión) | Cambiar el prompt del evaluador, `EVAL_SCHEMA` y el parseo a la vez, y recalibrar | Con el golden set puntuado |
| F. Silencios y demora en responder | Cuánto tarda en empezar a hablar, pausas largas | Medir el volumen de la grabación; el reproductor ya lo hace para las citas | Cuando haya llamadas reales grabadas |

El grupo E es el de más valor para una empresa de call center, y también el de más riesgo: toca el evaluador que ya está calibrado.

Otros datos que se evaluaron y no se recomiendan por ahora:

- **Tono de voz o emoción:** no se puede medir de forma confiable (sección 1.3).
- **Reconocimiento de voz con tiempos por palabra:** daría citas exactas y silencios precisos, pero es pago y obliga a cambiar el texto del consentimiento.

### 3.4 Hueco en el esquema de Postgres

Las migraciones de `db/migrations/` definen `simulaciones`, `transcripcion_turnos`, `informes` e `informe_criterios`, pero los informes siguen en JSON. Cuando se migren, el esquema actual no tiene lugar para:

- Los segundos de cada turno (`t0`, `t1`) en `transcripcion_turnos`.
- El audio (tipo, tamaño, duración, fecha de subida y de borrado).
- La aceptación de la grabación (texto, versión, respuesta, fecha).
- Los datos de la llamada (`metricas`).
- El mail guardado en el informe.

`simulaciones.escenario_id` existe pero queda en NULL: los escenarios todavía no están en la base. El informe ya guarda `escenario.id`, así que el dato está para cuando se migre.

## 4. Lo que depende de otras personas

- **RR. HH.:** puntuar los 9 casos de la planilla, confirmar la escala nueva del puntaje y los pesos de los criterios de MKT.
- **MKT:** confirmar lo marcado como "[confirmar con MKT]" en `docs/escenarios-mkt.md` y decidir si pedir datos en una saliente es falta grave aunque se corrija.
- **Un abogado:** revisar el texto de la casilla de grabación (Ley 25.326). Si cambia el texto, hay que cambiar `GRABACION.version` en `app.js`.
- **Quien maneja el despliegue:** confirmar que la carpeta de datos sobrevive cuando se reemplaza el servidor en AWS. Si no, los audios y los informes se pierden.
- **Pruebas con voz real:** escuchar los fragmentos de las citas, el acento en una llamada de más de 5 minutos y los datos de la llamada con Gemini Live.
