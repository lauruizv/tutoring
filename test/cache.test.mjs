/* Caché de prompts: el modelo tiene que recibir exactamente el mismo texto que antes
   (system y mensajes), solo partido en bloques con cache_control cuando el proveedor es
   Claude por API. Con Gemini y con el caché apagado, el pedido no cambia en nada. */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApp, pedir, pedirMensajes } from "./helpers.mjs";

const plano = c => Array.isArray(c) ? c.map(b => b.text).join("") : c;
const ESTABLE = "Sos el mentor de IA de Nodo Software.\n\nREGLAS\n- " + "Regla fija de la empresa. ".repeat(300) + "\n\nCONTEXTO DE LA EMPRESA\nDatos.";
const VARIABLE = "\n\nACCIÓN: RESOLVER UNA TAREA\nAvanzá por etapas.";
const SYSTEM = ESTABLE + VARIABLE;
const HISTORIAL = [
  { role: "user", content: "¿Cómo funcionan los recordatorios?" },
  { role: "assistant", content: "[Cómo se hace] Corren cada 15 minutos." },
  { role: "user", content: "¿Y si fallan?" }
];
const chat = (extra = {}) => ({ purpose: "chat", system: SYSTEM, system_estable: ESTABLE.length, messages: HISTORIAL, ...extra });

describe("caché de prompts con Claude (anthropic)", () => {
  let app;
  before(async () => { app = await startApp({ provider: "anthropic" }); });
  after(async () => { await app.stop(); });

  test("el modelo recibe el mismo texto, con cache_control al final de la parte estable y en el último mensaje", async () => {
    const r = await pedirMensajes(app.base, chat());
    assert.equal(r.status, 200);
    const p = app.fake.calls.at(-1).payload;
    assert.equal(plano(p.system), SYSTEM, "el system unido tiene que ser idéntico al original");
    assert.equal(p.system.length, 2);
    assert.equal(p.system[0].text, ESTABLE);
    assert.deepEqual(p.system[0].cache_control, { type: "ephemeral" });
    assert.equal(p.system[1].cache_control, undefined);
    assert.deepEqual(p.messages.map(m => ({ role: m.role, content: plano(m.content) })), HISTORIAL);
    assert.deepEqual(p.messages.at(-1).content[0].cache_control, { type: "ephemeral" });
    assert.equal(p.messages.filter(m => Array.isArray(m.content)).length, 1, "solo el último mensaje lleva corte");
  });

  test("desde la segunda consulta lee del caché y lo suma al diagnóstico", async () => {
    await pedirMensajes(app.base, chat({ messages: [{ role: "user", content: "Otra pregunta" }] }));
    const { cuerpo } = await pedir(app.base, "/api/diagnostico");
    // La parte estable del system se lee del caché; el mensaje nuevo se escribe.
    assert.match(app.log(), /caché: escritos=\d+ leídos=[1-9]\d*, [1-9]\d*% cacheado/);
    assert.equal(cuerpo.cache.activo, true);
    const t = cuerpo.cache.proveedores.anthropic;
    assert.equal(t.consultas, 2);
    assert.ok(t.leidosDelCache > 0 && t.escritosEnCache > 0);
    assert.ok(cuerpo.cache.tokensAhorrados > 0);
  });

  test("la evaluación no marca el mensaje (es una sola consulta)", async () => {
    await pedirMensajes(app.base, { purpose: "eval", system: "Sos un evaluador riguroso y justo.", messages: [{ role: "user", content: "evaluá esto" }] });
    const p = app.fake.calls.at(-1).payload;
    assert.equal(typeof p.messages[0].content, "string");
    assert.equal(plano(p.system), "Sos un evaluador riguroso y justo.");
  });

  test("un system_estable que no cierra se ignora (todo el system es un bloque)", async () => {
    await pedirMensajes(app.base, chat({ system_estable: SYSTEM.length + 5 }));
    const p = app.fake.calls.at(-1).payload;
    assert.equal(p.system.length, 1);
    assert.equal(p.system[0].text, SYSTEM);
  });

  test("si la API rechaza el caché, la consulta sale igual sin caché", async () => {
    const r = await pedirMensajes(app.base, chat({ messages: [{ role: "user", content: "FALLA_CACHE hola" }] }));
    assert.equal(r.status, 200);
    assert.ok(r.texto.length > 0);
    const p = app.fake.calls.at(-1).payload;
    assert.equal(p.system, SYSTEM);
    assert.equal(p.messages[0].content, "FALLA_CACHE hola");
  });
});

describe("caché de prompts apagado (PROMPT_CACHE=off)", () => {
  let app;
  before(async () => { app = await startApp({ provider: "anthropic", env: { PROMPT_CACHE: "off" } }); });
  after(async () => { await app.stop(); });

  test("el pedido sale como siempre: system y mensajes como texto, sin cache_control", async () => {
    await pedirMensajes(app.base, chat());
    const p = app.fake.calls.at(-1).payload;
    assert.equal(p.system, SYSTEM);
    assert.deepEqual(p.messages, HISTORIAL);
    assert.ok(!JSON.stringify(p).includes("cache_control"));
  });
});

describe("caché de prompts con Gemini (implícito)", () => {
  let app;
  before(async () => { app = await startApp({ provider: "gemini" }); });
  after(async () => { await app.stop(); });

  test("Gemini recibe el system como un solo texto idéntico, primero, sin campos nuevos", async () => {
    await pedirMensajes(app.base, chat());
    const p = app.fake.calls.at(-1).payload;
    assert.deepEqual(p.messages, [{ role: "system", content: SYSTEM }, ...HISTORIAL]);
    assert.ok(!JSON.stringify(p).includes("cache"));
    assert.ok(!("system_estable" in p));
  });
});
