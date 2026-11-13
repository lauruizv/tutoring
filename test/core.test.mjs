/* Pruebas de la lógica pura de public/js/core.js:
   historial que se manda a la IA, parseo del JSON de evaluación, puntaje ponderado
   y corte de oraciones para la voz. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../public/js/core.js");

describe("normalizarHistorial", () => {
  test("empieza en user y alterna", () => {
    const h = core.normalizarHistorial([
      { role: "assistant", content: "hola, soy el cliente" },
      { role: "user", content: "buen día" },
      { role: "assistant", content: "te cuento" },
      { role: "user", content: "dale" }
    ]);
    assert.deepEqual(h.map(m => m.role), ["user", "assistant", "user"]);
  });

  test("junta turnos seguidos del mismo rol", () => {
    const h = core.normalizarHistorial([
      { role: "user", content: "una" },
      { role: "user", content: "dos" },
      { role: "assistant", content: "ok" }
    ]);
    assert.deepEqual(h, [{ role: "user", content: "una\n\ndos" }, { role: "assistant", content: "ok" }]);
  });

  test("descarta vacíos y nulos sin romper la alternancia", () => {
    const h = core.normalizarHistorial([
      { role: "user", content: "hola" },
      { role: "assistant", content: "   " },
      null,
      { role: "user", content: "seguís ahí?" }
    ]);
    assert.deepEqual(h, [{ role: "user", content: "hola\n\nseguís ahí?" }]);
  });

  test("al recortar por cantidad no queda arrancando en assistant", () => {
    const largo = [];
    for (let i = 0; i < 10; i++) largo.push({ role: i % 2 ? "assistant" : "user", content: "m" + i });
    const h = core.normalizarHistorial(largo, 5);
    assert.equal(h[0].role, "user");
    assert.ok(h.length <= 5);
    h.forEach((m, i) => { if (i) assert.notEqual(m.role, h[i - 1].role); });
  });

  test("tolera listas inválidas", () => {
    assert.deepEqual(core.normalizarHistorial(null), []);
    assert.deepEqual(core.normalizarHistorial("hola"), []);
    assert.deepEqual(core.normalizarHistorial([{ role: "assistant", content: "solo assistant" }]), []);
  });
});

describe("parseEvaluacion", () => {
  const base = { criterios: [{ nombre: "Empatía", puntaje: 4, evidencia: "cita", comentario: "bien" }] };

  test("acepta JSON limpio", () => {
    const ev = core.parseEvaluacion(JSON.stringify({ ...base, resumen: "le fue bien", fortalezas: ["a", "b"] }));
    assert.equal(ev.resumen, "le fue bien");
    assert.deepEqual(ev.fortalezas, ["a", "b"]);
    assert.equal(ev.criterios[0].puntaje, 4);
  });

  test("acepta bloque ``` y texto alrededor", () => {
    const ev = core.parseEvaluacion("Claro, acá va:\n```json\n" + JSON.stringify(base) + "\n```\nEspero que sirva.");
    assert.equal(ev.criterios[0].nombre, "Empatía");
  });

  test("acepta comas de más", () => {
    const ev = core.parseEvaluacion('{"criterios":[{"nombre":"Claridad","puntaje":3,}],"fortalezas":["x",],}');
    assert.equal(ev.criterios[0].nombre, "Claridad");
  });

  test("normaliza puntajes escritos raro", () => {
    const ev = core.parseEvaluacion('{"criterios":[{"nombre":"a","puntaje":"4/5"},{"nombre":"b","puntaje":"tres"},{"nombre":"c","puntaje":9},{"nombre":"d"}]}');
    assert.deepEqual(ev.criterios.map(c => c.puntaje), [4, null, null, null]);
  });

  test("convierte a lista lo que vino como texto", () => {
    const ev = core.parseEvaluacion('{"criterios":[{"nombre":"a","puntaje":3}],"fortalezas":"una sola cosa","a_mejorar":null}');
    assert.deepEqual(ev.fortalezas, ["una sola cosa"]);
    assert.deepEqual(ev.a_mejorar, []);
  });

  test("devuelve null si no hay criterios", () => {
    assert.equal(core.parseEvaluacion("No puedo evaluar esto."), null);
    assert.equal(core.parseEvaluacion('{"resumen":"ok"}'), null);
    assert.equal(core.parseEvaluacion('{"criterios":[]}'), null);
    assert.equal(core.parseEvaluacion(""), null);
    assert.equal(core.parseEvaluacion(null), null);
  });
});

describe("puntajePonderado", () => {
  const defs = [
    { nombre: "Escucha activa", peso: 3 },
    { nombre: "Claridad", peso: 2 },
    { nombre: "Empatía", peso: 1 }
  ];

  test("pondera por peso", () => {
    const r = core.puntajePonderado(defs, [
      { nombre: "Escucha activa", puntaje: 5 },
      { nombre: "Claridad", puntaje: 3 },
      { nombre: "Empatía", puntaje: 1 }
    ]);
    // Niveles a 0-100 (1 = 0, 2 = 35, 3 = 65, 4 = 85, 5 = 100): (100*3 + 65*2 + 0*1) / 6 = 71,7
    assert.equal(r.puntaje, 72);
    assert.equal(r.cubiertos, 3);
    assert.equal(r.total, 3);
  });

  test("empareja sin importar acentos ni mayúsculas", () => {
    const r = core.puntajePonderado(defs, [
      { nombre: "escucha ACTIVA", puntaje: 5 },
      { nombre: "claridad", puntaje: 5 },
      { nombre: "EMPATIA", puntaje: 5 }
    ]);
    assert.equal(r.puntaje, 100);
    assert.equal(r.cubiertos, 3);
  });

  test("informa cuántos criterios quedaron sin puntuar", () => {
    const r = core.puntajePonderado(defs, [{ nombre: "Claridad", puntaje: 4 }]);
    assert.equal(r.cubiertos, 1);
    assert.equal(r.total, 3);
    assert.equal(r.puntaje, 85);
  });

  test("cumplir bien (todo 3) da 65, no 50", () => {
    const r = core.puntajePonderado(defs, defs.map(d => ({ nombre: d.nombre, puntaje: 3 })));
    assert.equal(r.puntaje, 65);
  });

  test("peso inválido cuenta como 1 y no rompe el cálculo", () => {
    const r = core.puntajePonderado([{ nombre: "a", peso: "x" }, { nombre: "b", peso: 0 }], [{ nombre: "a", puntaje: 5 }, { nombre: "b", puntaje: 5 }]);
    assert.equal(r.puntaje, 100);
  });

  test("sin datos no inventa puntaje", () => {
    assert.equal(core.puntajePonderado(defs, []).puntaje, null);
    assert.equal(core.puntajePonderado([], []).puntaje, null);
    assert.equal(core.puntajePonderado(defs, [{ nombre: "Claridad", puntaje: "no aplica" }]).puntaje, null);
  });
});

describe("textoHablable", () => {
  test("saca [FIN], markdown, código y acotaciones", () => {
    assert.equal(core.textoHablable("Hola **che**, *mirá* (suspira) esto `x`. [FIN]"), "Hola che, mirá esto x.");
    assert.equal(core.textoHablable("Mirá:\n```js\nconst a = 1;\n```\nlisto"), "Mirá: listo");
    assert.equal(core.textoHablable("[ fin ]"), "");
    assert.equal(core.textoHablable(null), "");
  });
});

describe("largoDecible", () => {
  test("corta al terminar una oración", () => {
    const t = "Hola, buen día. Te llamo por";
    assert.equal(t.slice(0, core.largoDecible(t, false)), "Hola, buen día. ");
  });

  test("espera si todavía no hay oración completa y es corta", () => {
    assert.equal(core.largoDecible("Hola buen día te", false), 0);
  });

  test("si se acumuló mucho sin punto, corta igual para no demorar la voz", () => {
    const t = "Mira lo que pasa es que los pacientes reciben dos mensajes por cada turno y eso me complica mucho la agenda del día porque llaman a recepción a preguntar";
    const n = core.largoDecible(t, false);
    assert.ok(n > 100 && n <= t.length, "cortó en " + n);
  });

  test("forzado entrega todo lo que queda", () => {
    assert.equal(core.largoDecible("sin puntuación final", true), "sin puntuación final".length);
    assert.equal(core.largoDecible("", true), 0);
  });
});

describe("rangoDeDias", () => {
  // Los días son en la hora de quien usa la app; por eso lo esperado se arma con la hora local de esta máquina.
  const comienzoDe = (anio, mes, dia) => new Date(anio, mes - 1, dia).toISOString();

  test("desde es el comienzo del día y hasta, el comienzo del día siguiente (para incluir el día entero)", () => {
    assert.deepEqual(core.rangoDeDias("2026-11-10", "2026-11-10"), { desde: comienzoDe(2026, 11, 10), hasta: comienzoDe(2026, 11, 11) });
  });

  test("el día siguiente cruza bien el fin de mes y el fin de año", () => {
    assert.equal(core.rangoDeDias("", "2026-11-30").hasta, comienzoDe(2026, 12, 1));
    assert.equal(core.rangoDeDias("", "2026-12-31").hasta, comienzoDe(2027, 1, 1));
    assert.equal(core.rangoDeDias("", "2028-02-28").hasta, comienzoDe(2028, 2, 29), "2028 es bisiesto");
  });

  test("un día vacío no filtra", () => {
    assert.deepEqual(core.rangoDeDias("", ""), { desde: "", hasta: "" });
    assert.deepEqual(core.rangoDeDias(undefined, null), { desde: "", hasta: "" });
    assert.equal(core.rangoDeDias("2026-11-10", "").hasta, "");
  });

  test("un día mal escrito o que no existe queda vacío", () => {
    for (const dia of ["10/11/2026", "2026-11-10T03:00:00Z", "ayer", "2026-02-31", "2026-13-01"]) {
      assert.deepEqual(core.rangoDeDias(dia, dia), { desde: "", hasta: "" }, dia);
    }
  });
});

describe("cronometroDeTurnos", () => {
  // Gemini Live manda la transcripción del candidato cuando termina de hablar, no mientras habla.
  // Son los tiempos de una llamada real: el cliente terminó a los 104,6 s, el candidato habló unos 20 s
  // y su texto llegó a los 129,6 s, un segundo antes de que el cliente empezara a contestar.
  test("el turno del candidato va desde que terminó el turno anterior hasta que llega su texto", () => {
    const c = core.cronometroDeTurnos();
    c.evento({ type: "state", state: "speaking" }, 98);
    c.cerrar("assistant", 104.6);
    c.evento({ type: "interim", text: "bueno dale, la mitad de 38.000 sería 19.000" }, 129.6);
    assert.deepEqual(c.cerrar("user", 130.4), { t0: 104.6, t1: 129.6 });
  });

  test("si el texto del candidato llega en varias partes, el turno termina con la última", () => {
    const c = core.cronometroDeTurnos();
    c.evento({ type: "state", state: "speaking" }, 1);
    c.cerrar("assistant", 4);
    c.evento({ type: "interim", text: "Hola" }, 10);
    c.evento({ type: "interim", text: "Hola, buen día" }, 11.23);
    assert.deepEqual(c.cerrar("user", 14.26), { t0: 4, t1: 11.2 }, "redondeado a la décima");
  });

  test("si el único texto llega pegado al final del turno anterior, el turno termina cuando se cierra", () => {
    const c = core.cronometroDeTurnos();
    c.evento({ type: "state", state: "speaking" }, 1);
    c.cerrar("assistant", 4);
    c.evento({ type: "interim", text: "Entiendo, contame" }, 4.02);   // sin esto quedaría un turno de 0 segundos, sin audio
    assert.deepEqual(c.cerrar("user", 9), { t0: 4, t1: 9 });
  });

  test("si el candidato habla primero, su turno empieza con la grabación", () => {
    const c = core.cronometroDeTurnos();
    c.evento({ type: "interim", text: "Hola, buen día, te habla Lucas" }, 7.4);
    assert.deepEqual(c.cerrar("user", 8), { t0: 0, t1: 7.4 });
  });

  test("el turno del cliente empieza cuando empieza a sonar", () => {
    const c = core.cronometroDeTurnos();
    c.evento({ type: "state", state: "thinking" }, 3);
    c.evento({ type: "state", state: "speaking" }, 4);
    c.evento({ type: "partial", text: "Hola, te llamo por" }, 4.4);
    assert.deepEqual(c.cerrar("assistant", 9), { t0: 4, t1: 9 });
    // También sirve el primer texto, si el aviso de que está hablando no llegó.
    c.evento({ type: "partial", text: "Otra cosa" }, 20);
    assert.deepEqual(c.cerrar("assistant", 22), { t0: 20, t1: 22 });
  });

  test("dos turnos seguidos del candidato: el segundo empieza donde terminó el primero", () => {
    const c = core.cronometroDeTurnos();
    c.evento({ type: "interim", text: "uno" }, 5);
    assert.deepEqual(c.cerrar("user", 7), { t0: 0, t1: 5 });
    c.evento({ type: "interim", text: "" }, 7);      // el motor limpia el texto al cerrar: no cuenta
    c.evento({ type: "interim", text: "dos" }, 30);
    assert.deepEqual(c.cerrar("user", 33), { t0: 5, t1: 30 });
  });

  test("si el candidato interrumpe al cliente, su turno empieza con su primer texto", () => {
    const c = core.cronometroDeTurnos();
    c.evento({ type: "state", state: "speaking" }, 2);
    c.evento({ type: "interim", text: "perdón, te interrumpo" }, 6);   // habla encima del cliente
    assert.deepEqual(c.cerrar("assistant", 6.5), { t0: 2, t1: 6.5 });
    // No llegó más texto después: el turno termina cuando se cierra.
    assert.deepEqual(c.cerrar("user", 9), { t0: 6, t1: 9 });
  });

  test("un turno escrito con el teclado no tiene audio y el siguiente no lo abarca", () => {
    const c = core.cronometroDeTurnos();
    assert.equal(c.cerrar("user", 12), null);
    c.evento({ type: "interim", text: "ahora sí, hablando" }, 20);
    assert.deepEqual(c.cerrar("user", 21), { t0: 12, t1: 20 });
  });

  test("si no se está grabando, ningún turno tiene tiempos", () => {
    const c = core.cronometroDeTurnos();
    c.evento({ type: "interim", text: "Hola" }, null);
    assert.equal(c.cerrar("user", null), null);
    c.evento({ type: "interim", text: "Hola" }, 5);
    assert.equal(c.cerrar("user", null), null, "se dejó de grabar antes de cerrar el turno");
  });
});

describe("comoSeDice", () => {
  test("un número de hasta seis cifras se cuenta como se dice, no como se escribe", () => {
    const casos = {
      "38.000": "treinta y ocho mil", "19000": "diecinueve mil", "6333": "seis mil trescientos treinta y tres",
      "1991": "mil novecientos noventa y uno", "1.000": "mil", "100": "cien", "101": "ciento uno", "200": "doscientos",
      "21": "veintiuno", "45": "cuarenta y cinco", "9": "nueve", "0": "cero", "500.000": "quinientos mil"
    };
    for (const [escrito, dicho] of Object.entries(casos)) assert.equal(core.comoSeDice(escrito), dicho, escrito);
  });

  test("un número largo o que empieza con cero se dicta cifra por cifra", () => {
    assert.equal(core.comoSeDice("8812461"), "ocho ocho uno dos cuatro seis uno");
    assert.equal(core.comoSeDice("33.221.004"), "tres tres dos dos uno cero cero cuatro");
    assert.equal(core.comoSeDice("termina en 004"), "termina en cero cero cuatro");
  });

  test("el resto del texto queda sin tildes, mayúsculas ni signos", () => {
    assert.equal(core.comoSeDice("¡Tres cuotas de 6333, Diego!"), "tres cuotas de seis mil trescientos treinta y tres diego");
    assert.equal(core.comoSeDice(null), "");
  });
});

describe("ubicarCita", () => {
  const turnos = [
    { role: "assistant", text: "¿Hola? ¿Quién habla?", t0: 0, t1: 3 },
    { role: "user", text: "Hola, buen día, te habla Lucas, de ConectAR. ¿Hablo con Diego Sosa?", t0: 3.5, t1: 9 },
    { role: "assistant", text: "Sí, soy yo. ¿Qué pasó?", t0: 9.5, t1: 12 },
    { role: "user", text: "Te llamo porque figuran dos facturas impagas, agosto y septiembre. ¿Cuánto podés pagar y cuándo?", t0: 12.5, t1: 21 },
    { role: "assistant", text: "Y… la verdad, poco.", t0: 21.5, t1: 24 },
    { role: "user", text: "Lo anoto y te mando el link de pago por WhatsApp.", t0: 24.5, t1: 29 },
    { role: "user", text: "Esto lo escribí con el teclado porque se cortó el micrófono, ¿me leés bien?" }
  ];
  const turno = cita => { const r = core.ubicarCita(turnos, cita); return r && r.indice; };

  test("encuentra el turno del candidato que tiene la cita y devuelve sus tiempos", () => {
    const r = core.ubicarCita(turnos, "¿Cuánto podés pagar y cuándo?");
    assert.deepEqual({ indice: r.indice, t0: r.t0, t1: r.t1 }, { indice: 3, t0: 12.5, t1: 21 });
  });

  // `desde` y `hasta` dicen en qué parte del texto del turno está la cita (0 = el comienzo, 1 = el final),
  // para después hacer sonar solo esa parte.
  test("dice en qué parte del turno está la cita", () => {
    const alFinal = core.ubicarCita(turnos, "¿Cuánto podés pagar y cuándo?");
    assert.ok(Math.abs(alFinal.desde - 65 / 92) < 0.001, "empieza después de 65 de las 92 letras: " + alFinal.desde);
    assert.equal(alFinal.hasta, 1);
    const alPrincipio = core.ubicarCita(turnos, "Te llamo porque figuran dos facturas impagas");
    assert.equal(alPrincipio.desde, 0);
    assert.ok(Math.abs(alPrincipio.hasta - 44 / 92) < 0.001, "termina en la letra 44 de 92: " + alPrincipio.hasta);
    const entero = core.ubicarCita(turnos, "Lo anoto y te mando el link de pago por WhatsApp.");
    assert.deepEqual([entero.desde, entero.hasta], [0, 1]);
  });

  test("los números de antes de la cita pesan lo que se tarda en decirlos", () => {
    const conMonto = [{ role: "user", t0: 0, t1: 9, text: "Tu deuda es de 38.000 pesos. ¿Podés pagar la mitad?" }];
    // "tu deuda es de treinta y ocho mil pesos " son 40 letras de 60; contando "38 000" serían 28 de 48.
    const r = core.ubicarCita(conMonto, "¿Podés pagar la mitad?");
    assert.ok(Math.abs(r.desde - 40 / 60) < 0.001, "la cita empieza más tarde: " + r.desde);
    assert.equal(r.hasta, 1);
  });

  test("si el candidato arrancó la frase dos veces, la cita es el tramo más corto que la contiene", () => {
    // De una llamada real: el evaluador citó la frase sin la vuelta del medio.
    const real = [{ role: "user", t0: 104.6, t1: 129.6, text: "bueno dale, la mitad de 38.000 sería ya mismo te digo, eh. La mitad de 38.000 sería 19.000, perfecto. Entonces, ¿me podés pagar 19.000 a fin de mes?" }];
    const r = core.ubicarCita(real, "La mitad de 38.000 sería 19.000, perfecto.");
    assert.ok(r.desde > 0.35 && r.desde < 0.45, "empieza en la segunda vez que dice «la mitad»: " + r.desde);
    assert.ok(r.hasta > 0.65 && r.hasta < 0.75, "termina en «perfecto» (los montos pesan lo que se tarda en decirlos): " + r.hasta);
    // Una cita con palabras cambiadas también queda acotada a su parte del turno.
    const parecida = core.ubicarCita(real, "Entonces, ¿me puedes pagar 19.000 a fin de mes?");
    assert.ok(parecida.desde > 0.6 && parecida.hasta === 1, JSON.stringify(parecida));
  });

  test("no importan las tildes, las mayúsculas, los signos ni las comillas", () => {
    assert.equal(turno("“te habla lucas de conectar”"), 1);
    assert.equal(turno("CUANTO PODES PAGAR Y CUANDO"), 3);
    assert.equal(turno("  Lo anoto, y te mando el link de pago...  "), 5);
  });

  test("una cita con un pedazo salteado (… o [...]) se busca por partes", () => {
    assert.equal(turno("Te llamo porque figuran dos facturas impagas… ¿Cuánto podés pagar y cuándo?"), 3);
    assert.equal(turno("te habla Lucas [...] ¿Hablo con Diego Sosa?"), 1);
    assert.equal(turno("figuran dos facturas impagas (...) y cuándo"), 3);
  });

  test("si el evaluador cambió o agregó alguna palabra, vale mientras casi toda la cita esté en orden", () => {
    assert.equal(turno("figuran dos facturas impagas de agosto y septiembre"), 3, "agregó 'de'");
    assert.equal(turno("le mando el link de pago por WhatsApp"), 5, "cambió 'te' por 'le'");
    assert.equal(turno("Te llamo porque tenés dos facturas sin pagar de agosto"), null, "es otra frase: comparte pocas palabras");
  });

  test("nunca devuelve un turno del cliente", () => {
    assert.equal(turno("Sí, soy yo. ¿Qué pasó?"), null);
    assert.equal(turno("la verdad, poco"), null);
  });

  test("un turno sin audio (escrito con el teclado) no sirve", () => {
    assert.equal(turno("Esto lo escribí con el teclado porque se cortó el micrófono"), null);
  });

  test("si no se parece lo suficiente a ningún turno, no adivina", () => {
    for (const cita of ["Sin evidencia en la conversación", "Le pido disculpas por la demora en atenderlo", "Que tengas un buen día y gracias por llamar", "", null, undefined, "…", "¿?"]) {
      assert.equal(core.ubicarCita(turnos, cita), null, String(cita));
    }
  });

  test("las palabras se comparan enteras: 'factura' no es 'facturas'", () => {
    assert.equal(turno("factura"), null);
    assert.equal(turno("facturas impagas"), 3);
  });

  test("una cita muy corta vale si está en un solo turno; si está en varios, no adivina", () => {
    assert.equal(turno("pagar"), 3, "'pagar' está en un solo turno del candidato");
    assert.equal(turno("WhatsApp"), 5);
    assert.equal(turno("te"), null, "'te' está en tres turnos");
    assert.equal(turno("buen día"), 1);
    const dosVeces = [{ role: "user", text: "Disculpame.", t0: 1, t1: 2 }, { role: "user", text: "Disculpame, se me cortó.", t0: 8, t1: 11 }];
    assert.equal(core.ubicarCita(dosVeces, "Disculpame"), null);
    assert.equal(core.ubicarCita(dosVeces, "se me cortó").indice, 1);
  });

  test("con dos turnos que tienen la cita, gana el que la tiene más completa y, si empatan, el primero", () => {
    const repetidos = [
      { role: "user", text: "Buen día, ¿en qué te puedo ayudar?", t0: 1, t1: 4 },
      { role: "user", text: "Listo. ¿En qué te puedo ayudar con la factura de este mes?", t0: 10, t1: 15 }
    ];
    assert.equal(core.ubicarCita(repetidos, "¿en qué te puedo ayudar?").indice, 0);
    assert.equal(core.ubicarCita(repetidos, "¿En qué te puedo ayudar con la factura de este mes?").indice, 1);
  });

  test("con informes viejos (turnos sin tiempos) o sin transcripción devuelve null", () => {
    assert.equal(core.ubicarCita([{ role: "user", text: "Hola, buen día, te habla Lucas" }], "te habla Lucas"), null);
    assert.equal(core.ubicarCita(undefined, "te habla Lucas"), null);
    assert.equal(core.ubicarCita([null, { role: "user" }], "te habla Lucas"), null);
  });
});

describe("tramoDeCita", () => {
  // El volumen del turno, un valor cada 0,05 s: `seg` segundos de silencio (un soplido de fondo) o de voz.
  const PASO = 0.05;
  const silencio = seg => new Array(Math.round(seg / PASO)).fill(0.002);
  const voz = seg => new Array(Math.round(seg / PASO)).fill(0.1);
  const cerca = (tramo, t0, t1) => assert.ok(tramo && Math.abs(tramo.t0 - t0) <= PASO + 1e-9 && Math.abs(tramo.t1 - t1) <= PASO + 1e-9, `esperaba ${t0}-${t1}: ${JSON.stringify(tramo)}`);

  test("saca el silencio de antes de empezar a hablar y la espera del final", () => {
    const niveles = [...silencio(2), ...voz(4), ...silencio(1)];
    cerca(core.tramoDeCita(niveles, PASO, { t0: 100, t1: 107, desde: 0, hasta: 1 }), 102, 106);
  });

  test("una cita que está en la segunda mitad del turno suena en la segunda mitad de lo hablado", () => {
    const niveles = [...silencio(2), ...voz(4), ...silencio(1)];
    cerca(core.tramoDeCita(niveles, PASO, { t0: 100, t1: 107, desde: 0.5, hasta: 1 }), 104, 106);
    cerca(core.tramoDeCita(niveles, PASO, { t0: 100, t1: 107, desde: 0.25, hasta: 0.5 }), 103, 104);
  });

  test("una pausa en el medio no cuenta como texto: solo se reparte sobre lo hablado", () => {
    const niveles = [...voz(2), ...silencio(3), ...voz(2)];
    cerca(core.tramoDeCita(niveles, PASO, { t0: 10, t1: 17, desde: 0.5, hasta: 1 }), 15, 17);
    cerca(core.tramoDeCita(niveles, PASO, { t0: 10, t1: 17, desde: 0, hasta: 0.5 }), 10, 12);
  });

  test("el umbral se ajusta al volumen de quien habla: una voz baja también se detecta", () => {
    const bajita = new Array(40).fill(0.02);
    cerca(core.tramoDeCita([...silencio(1), ...bajita, ...silencio(1)], PASO, { t0: 0, t1: 4, desde: 0, hasta: 1 }), 1, 3);
  });

  test("si no se distingue ninguna voz, o no hay volumen, suena el turno entero", () => {
    const turno = { t0: 20, t1: 26, desde: 0.5, hasta: 1 };
    assert.deepEqual(core.tramoDeCita(silencio(6), PASO, turno), { t0: 20, t1: 26 });
    assert.deepEqual(core.tramoDeCita([], PASO, turno), { t0: 20, t1: 26 });
    assert.deepEqual(core.tramoDeCita(undefined, PASO, turno), { t0: 20, t1: 26 });
  });

  test("sin la posición de la cita, suena todo lo hablado del turno", () => {
    cerca(core.tramoDeCita([...silencio(1), ...voz(2), ...silencio(1)], PASO, { t0: 50, t1: 54 }), 51, 53);
  });
  // Una frase casi siempre empieza después de una pausa corta: si hay una cerca del comienzo estimado, se arranca ahí.
  test("si cerca del comienzo estimado hay una pausa, la cita arranca justo después de la pausa", () => {
    const niveles = [...voz(2), ...silencio(0.4), ...voz(4)];   // la pausa termina a los 2,4 s
    cerca(core.tramoDeCita(niveles, PASO, { t0: 0, t1: 6.4, desde: 0.3, hasta: 1 }), 2.4, 6.4);    // estimado: 1,8 s
    cerca(core.tramoDeCita(niveles, PASO, { t0: 0, t1: 6.4, desde: 0.45, hasta: 1 }), 2.4, 6.4);   // estimado: 3,1 s
  });

  test("una pausa lejana o un corte de un instante no mueven el comienzo", () => {
    const lejos = [...voz(2), ...silencio(0.4), ...voz(6)];
    cerca(core.tramoDeCita(lejos, PASO, { t0: 0, t1: 8.4, desde: 0.75, hasta: 1 }), 6.4, 8.4);     // la pausa quedó 4 s atrás
    const instante = [...voz(2), ...silencio(0.05), ...voz(2)];
    cerca(core.tramoDeCita(instante, PASO, { t0: 0, t1: 4.05, desde: 0.6, hasta: 1 }), 2.45, 4.05);
  });
});

describe("tiemposDePalabras", () => {
  const PASO = 0.05;
  const silencio = seg => new Array(Math.round(seg / PASO)).fill(0.002);
  const voz = seg => new Array(Math.round(seg / PASO)).fill(0.1);
  const cerca = (tiempos, esperados) => assert.ok(tiempos.length === esperados.length && tiempos.every((t, i) => Math.abs(t - esperados[i]) <= PASO + 1e-9), `esperaba ${esperados}: ${tiempos}`);

  test("reparte las palabras de la cita sobre lo que suena, cada una según su largo", () => {
    cerca(core.tiemposDePalabras(voz(4), PASO, 10, "hola hola hola hola"), [10, 11, 12, 13]);
    cerca(core.tiemposDePalabras(voz(3), PASO, 0, "a bcdef"), [0, 0.75]);   // con el espacio: 2 letras de 8
  });

  test("las pausas no se reparten: la palabra siguiente se ilumina cuando vuelve la voz", () => {
    cerca(core.tiemposDePalabras([...silencio(0.5), ...voz(1), ...silencio(2), ...voz(1)], PASO, 20, "hola hola"), [20.5, 23.5]);
  });

  test("un número dura lo que se tarda en decirlo", () => {
    // "38.000" son 18 letras dichas (más el espacio, 19) y "ya", 3: la segunda palabra empieza a los 19/22.
    cerca(core.tiemposDePalabras(voz(4.4), PASO, 0, "38.000 ya"), [0, 3.8]);
  });

  test("sin voz se reparte parejo, y sin volumen o sin texto no hay tiempos", () => {
    cerca(core.tiemposDePalabras(silencio(4), PASO, 0, "hola hola"), [0, 2]);
    assert.deepEqual(core.tiemposDePalabras([], PASO, 0, "hola hola"), []);
    assert.deepEqual(core.tiemposDePalabras(voz(2), PASO, 0, "  "), []);
  });
});
