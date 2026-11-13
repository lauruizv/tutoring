# Calibración del evaluador con la cobranza de MKT

Seis conversaciones sintéticas del escenario `mkt-cobranza`: cinco ordenadas de mejor a peor y una que prueba la validación en una llamada saliente.

| Caso | Qué hace el operador | Total esperado |
|---|---|---|
| `01_excelente` | Sigue el guion completo y arma el plan con lo que contó el cliente | 80-100 |
| `02_bueno` | Cumple el guion sin errores graves, pero sin brillar | 60-80 |
| `03_mediocre` | Valida bien, pero no pregunta qué puede pagar, deja montos vagos y no cierra | 25-55 |
| `04_malo` | Juzga, insiste con el pago total y corta sin acuerdo ni número | 5-30 |
| `05_falla_compliance` | Dice la deuda sin validar, amenaza con el Veraz e inventa un recargo | 0-15 |
| `06_pide_datos` | Buena llamada, pero le pide el DNI y la fecha de nacimiento al cliente (en una saliente no se piden: se dicen para que confirme) | 60-85, Procedimiento 1-3 |

Sirven para comprobar que el evaluador ordena bien las llamadas y que una llamada que sigue el guion de la campaña (el procedimiento `p-cobranza` y la `ficha` del escenario en `defaults.js`) saca un puntaje alto.

Los rangos esperados los pusimos nosotros y son **provisorios**: no reemplazan al golden set de `evals/golden-mkt/`, que puntúa RR. HH.

```
python evals/run_evals.py evals/calibracion-mkt -n 3 --levantar-servidor
```
