/* Llamada con Gemini Live en un navegador de verdad, con la conexión SIMULADA:
   reemplazamos el WebSocket de Google por uno falso que habla el mismo protocolo
   (setupComplete, serverContent con audio PCM 24 kHz, transcripciones, interrupted,
   turnComplete y toolCall). El token sale del servidor contra la API falsa.
   Micrófono: el falso de Chromium (un tono), así se prueba el AudioWorklet de verdad.

   Cubre: token del servidor, setup (modelo, consigna, voz, transcripción), el cliente
   habla primero, audio del micrófono a 16 kHz, transcripción en engine.history,
   interrupción que corta el audio al instante, cierre con la herramienta colgar,
   evaluación con la transcripción de los dos lados y el botón "Seguir con otra voz". */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startApp, pedir, ingresarEn, configEjemplo, atenderEn } from "./helpers.mjs";

let chromium = null;
try { ({ chromium } = await import("playwright")); } catch (_) {}
const saltear = chromium ? false : "Falta Playwright: corré `npm install` y `npx playwright install chromium`.";

// Corre dentro de la página antes que la app.
function simularGeminiLive() {
  const W = window.WebSocket;
  const live = window.__live = { urls: [], enviados: [], abiertos: [], fallar: "", fuentes: { iniciadas: 0, cortadas: 0, terminadas: 0 } };

  // Contamos el audio del cliente que se programa y el que se corta.
  const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (...a) {
    live.fuentes.iniciadas++;
    live.ultimoInicio = a;   // (cuándo, desde qué segundo, cuánto): para saber qué tramo de una grabación sonó
    this.addEventListener("ended", () => { if (!this.__cortada) live.fuentes.terminadas++; });
    return start.apply(this, a);
  };
  AudioBufferSourceNode.prototype.stop = function (...a) { this.__cortada = true; live.fuentes.cortadas++; return stop.apply(this, a); };

  // PCM 16 bits, 24 kHz, en base64: un tono de "ms" milisegundos.
  live.audio = ms => {
    const n = Math.round(24 * ms), b = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) { const v = Math.round(Math.sin(i / 8) * 8000) & 0xffff; b[2 * i] = v & 0xff; b[2 * i + 1] = v >> 8; }
    let s = ""; b.forEach(x => { s += String.fromCharCode(x); }); return btoa(s);
  };

  class LiveFalso {
    constructor(url) {
      this.url = url; this.readyState = 0;
      this.mios = [];   // lo que se mandó por este socket
      live.urls.push(url); live.abiertos.push(this); live.ws = this;
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 20);
    }
    send(data) {
      const m = JSON.parse(data);
      live.enviados.push(m); this.mios.push(m);
      if (m.setup) {
        if (live.fallar) return setTimeout(() => this.close(1008, live.fallar), 20);
        return this.servidor({ setupComplete: {} });
      }
      // El cliente habla primero: contesta al pie de arranque.
      if (m.realtimeInput && m.realtimeInput.text && live.enviados.filter(x => x.realtimeInput && x.realtimeInput.text).length === 1) {
        live.decir("Hola, buen día. Te llamo porque mis pacientes reciben dos recordatorios.", 400);
      }
    }
    servidor(m) { setTimeout(() => { if (this.readyState === 1) this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }, 10); }
    close(code = 1000, reason = "") {
      if (this.readyState === 3) return;
      this.readyState = 3;
      setTimeout(() => this.onclose && this.onclose({ code, reason }), 0);
    }
  }
  // El cliente dice algo: transcripción + audio en dos pedazos + fin de turno.
  live.decir = (texto, ms, { terminar = true } = {}) => {
    const ws = live.ws, mitad = Math.ceil(texto.length / 2);
    ws.servidor({ serverContent: { outputTranscription: { text: texto.slice(0, mitad) }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: live.audio(ms / 2) } }] } } });
    ws.servidor({ serverContent: { outputTranscription: { text: texto.slice(mitad) }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: live.audio(ms / 2) } }] } } });
    if (terminar) ws.servidor({ serverContent: { turnComplete: true } });
  };
  live.escuchar = texto => live.ws.servidor({ serverContent: { inputTranscription: { text: texto } } });
  window.WebSocket = function (url, p) { return /falso\.test/.test(url) ? new LiveFalso(url) : new W(url, p); };
  window.WebSocket.OPEN = 1;
}

// Cuenta los osciladores (timbre), los filtros (voz telefónica) y las grabaciones que arma la página.
function espiarAudio() {
  const a = window.__audio = { osciladores: 0, parados: 0, filtros: [], grabaciones: 0 };
  const grabar = MediaRecorder.prototype.start;
  MediaRecorder.prototype.start = function (...x) { a.grabaciones++; return grabar.apply(this, x); };
  const osc = BaseAudioContext.prototype.createOscillator, fil = BaseAudioContext.prototype.createBiquadFilter;
  BaseAudioContext.prototype.createOscillator = function () {
    a.osciladores++;
    const o = osc.call(this), stop = o.stop.bind(o);
    o.stop = (...x) => { a.parados++; return stop(...x); };
    return o;
  };
  BaseAudioContext.prototype.createBiquadFilter = function () {
    const f = fil.call(this);
    queueMicrotask(() => a.filtros.push(f.type));
    return f;
  };
}

describe("voz con Gemini Live (conexión simulada)", { skip: saltear }, () => {
  let app, browser, page, errores;
  const esperarVista = t => page.waitForFunction(x => document.getElementById("viewLabel").textContent === x, t, { timeout: 15000 });
  const estado = () => page.evaluate(() => document.querySelector(".orb.big").className.replace("orb big ", ""));
  const esperarEstado = s => page.waitForFunction(x => document.querySelector(".orb.big") && document.querySelector(".orb.big").classList.contains(x), s, { timeout: 5000 });

  before(async () => {
    app = await startApp({ provider: "gemini", env: { VOICE_PROVIDER: "gemini-live", GEMINI_LIVE_WS_URL: "wss://falso.test/live" } });
    browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  });
  after(async () => {
    if (browser) await browser.close();
    if (app) await app.stop();
  });

  async function abrirLlamada({ atender = true, grabar = false } = {}) {
    const ctx = await browser.newContext({ locale: "es-AR", permissions: ["microphone"] });
    page = await ctx.newPage();
    errores = [];
    page.on("pageerror", e => errores.push(String(e)));
    page.on("dialog", d => d.accept());
    await page.addInitScript(simularGeminiLive);
    await page.addInitScript(espiarAudio);
    await ingresarEn(page, app.base, "estudiante1");
    await page.locator(".card", { hasText: "Viernes 19:30" }).click();   // la clienta es Agustina
    await esperarVista("Simulación");
    assert.doesNotMatch(await page.locator(".brief").innerText(), /Voz natural/);
    if (grabar) await page.locator("#aceptaGrabacion").check();
    await page.locator("#startCall").click();
    if (atender) await atenderEn(page);
    await esperarVista("Llamada en curso");
  }
  // Cambia el escenario de Agustina y lo deja como estaba al terminar.
  async function conEscenario(cambiar, prueba) {
    const cfg = configEjemplo();
    cambiar(cfg, cfg.escenarios.find(e => /Viernes 19:30/.test(e.titulo)));
    assert.equal((await pedir(app.base, "/api/empresa", { method: "PUT", json: cfg })).status, 200);
    try { await prueba(); assert.deepEqual(errores, []); await page.context().close(); }
    finally { await pedir(app.base, "/api/empresa", { method: "PUT", json: configEjemplo() }); }
  }
  const mandoAudio = () => page.evaluate(() => window.__live.enviados.filter(m => m.realtimeInput && m.realtimeInput.audio).length);

  test("llamada entrante: suena el timbre, conecta con el micrófono cerrado y el audio pasa recién al atender", () =>
    conEscenario((cfg, e) => { e.inicio = "atiende"; }, async () => {
      await abrirLlamada({ atender: false });
      assert.match(await page.locator(".state-label").textContent(), /Llamada entrante/);
      assert.equal(await estado(), "ringing");
      assert.ok(await page.evaluate(() => window.__audio.osciladores) >= 2, "suena el timbre");
      await page.waitForFunction(() => !document.querySelector("#atender").disabled, null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => window.__live.urls.length), 1, "conectó mientras sonaba");
      await page.waitForTimeout(500);
      assert.equal(await mandoAudio(), 0, "mientras suena no se manda el micrófono");
      await page.locator("#atender").click();
      await page.waitForFunction(() => /saludá vos primero/.test(document.querySelector(".state-label").textContent), null, { timeout: 5000 });
      assert.equal(await page.locator("#atender").count(), 0);
      await page.waitForFunction(() => window.__live.enviados.some(m => m.realtimeInput && m.realtimeInput.audio), null, { timeout: 5000 });
      assert.ok(await page.evaluate(() => window.__audio.parados) >= 2, "el timbre se cortó");
    }));

  test("si el cliente habla primero, no conecta hasta que el candidato atiende", () =>
    conEscenario(() => {}, async () => {
      await abrirLlamada({ atender: false });
      assert.equal(await page.locator("#atender").isEnabled(), true);
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => window.__live.urls.length), 0, "todavía no conectó");
      await page.locator("#atender").click();
      await page.waitForFunction(() => document.querySelectorAll(".transcript .ln.c").length >= 1, null, { timeout: 8000 });
    }));

  test("llamada saliente: el candidato toca Llamar y suena el tono hasta que el cliente atiende", () =>
    conEscenario((cfg, e) => { e.inicio = "llama"; }, async () => {
      await abrirLlamada({ atender: false });
      assert.equal(await page.locator("#atender").count(), 0, "no hay Atender: llama el candidato");
      assert.match(await page.locator(".state-label").textContent(), /Agustina Ferrari · 11 6\d{3}-\d{4}/, "a quién llama y su número");
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => window.__audio.osciladores), 0, "antes de marcar no suena nada");
      assert.equal(await page.evaluate(() => window.__live.urls.length), 0, "ni conecta");
      await page.locator("#llamar").click();
      assert.equal(await page.locator("#llamar").count(), 0);
      assert.match(await page.locator(".state-label").textContent(), /Llamando a Agustina/);
      assert.equal(await page.evaluate(() => window.__audio.osciladores), 1, "un solo tono, el de llamada");
      await page.waitForFunction(() => window.__live.enviados.some(m => m.realtimeInput && m.realtimeInput.text), null, { timeout: 8000 });
      await page.waitForFunction(() => !/Llamando/.test(document.querySelector(".state-label").textContent), null, { timeout: 5000 });
      assert.ok(await page.evaluate(() => window.__audio.parados) >= 1, "el tono se cortó cuando atendió");
    }));

  test("mientras suena solo está el botón verde, centrado; al atender aparecen Colgar y los controles", async () => {
    await abrirLlamada({ atender: false });
    await page.locator("#atender:not([disabled]), #llamar").first().waitFor();
    assert.equal(await page.locator("#hang").isVisible(), false, "sin Colgar mientras suena");
    assert.equal(await page.locator(".controls").isVisible(), false, "sin la barra de controles");
    const centro = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const boton = centro(await page.locator(".atender").boundingBox());
    const llamada = centro(await page.locator("#body").boundingBox());
    assert.ok(Math.abs(boton.x - llamada.x) < 2, `centrado a lo ancho (${boton.x} vs ${llamada.x})`);
    const orb = await page.locator(".orb").boundingBox();
    const bloque = (orb.y + (await page.locator(".atender").boundingBox()).y + 52) / 2;
    assert.ok(Math.abs(bloque - llamada.y) < 30, `el bloque del timbre está en el medio (${bloque} vs ${llamada.y})`);
    await atenderEn(page);
    await page.locator("#hang").waitFor({ state: "visible" });
    assert.ok(await page.locator(".controls").isVisible());
    assert.deepEqual(errores, []);
    await page.context().close();
  });

  test("colgar mientras suena el tono de llamada vuelve al brief sin conectar", () =>
    conEscenario((cfg, e) => { e.inicio = "llama"; }, async () => {
      await abrirLlamada({ atender: false });
      await page.locator("#llamar").click();
      await page.locator("#hang").click();
      await esperarVista("Simulación");
      await page.waitForTimeout(3800);
      assert.equal(await page.evaluate(() => window.__live.urls.length), 0, "no conecta después de colgar");
      assert.ok(await page.evaluate(() => window.__audio.parados) >= 1, "el tono se cortó");
    }));

  test("antes de llamar: elige micrófono, mide el nivel, prueba el sonido y la llamada usa ese micrófono", async () => {
    const ctx = await browser.newContext({ locale: "es-AR", permissions: ["microphone"] });
    page = await ctx.newPage();
    errores = [];
    page.on("pageerror", e => errores.push(String(e)));
    await page.addInitScript(simularGeminiLive);
    await page.addInitScript(espiarAudio);
    await page.addInitScript(() => {
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__mics = [];
      navigator.mediaDevices.getUserMedia = async c => { const st = await gum(c); window.__mics.push({ c, st }); return st; };
    });
    await ingresarEn(page, app.base, "estudiante1");
    await page.locator(".card", { hasText: "Viernes 19:30" }).click();
    const audio = page.locator(".audio");
    assert.match(await audio.innerText(), /probá tu audio/i);
    // Con el micrófono ya permitido, la barra arranca sola y se mueve con el micrófono falso (un tono).
    await page.waitForFunction(() => /Te escuchamos bien/.test(document.querySelector(".audio-msg").textContent), null, { timeout: 8000 });
    assert.equal(await page.locator(".nivel").isVisible(), true);
    const opciones = await page.locator('select[aria-label="Micrófono"] option').evaluateAll(os => os.map(o => o.value));
    assert.equal(opciones[0], "", "primero, el predeterminado");
    assert.ok(opciones.length >= 2, "lista los micrófonos");
    await page.locator('select[aria-label="Micrófono"]').selectOption(opciones[1]);
    await page.waitForFunction(id => window.__mics.some(m => m.c.audio && m.c.audio.deviceId && m.c.audio.deviceId.exact === id), opciones[1]);

    const antes = await page.evaluate(() => window.__audio.osciladores);
    await page.locator("button", { hasText: "Probar sonido" }).click();
    assert.equal(await page.evaluate(() => window.__audio.osciladores), antes + 2, "suenan las dos notas");

    await page.locator("#startCall").click();
    // Al salir del brief se cierra el micrófono de la prueba.
    assert.ok(await page.evaluate(() => window.__mics.slice(0, -1).every(m => m.st.getTracks().every(t => t.readyState === "ended"))));
    await atenderEn(page);
    await page.waitForFunction(() => window.__live.enviados.some(m => m.setup));
    const ultimo = await page.evaluate(() => window.__mics[window.__mics.length - 1].c.audio);
    assert.equal(ultimo.deviceId.exact, opciones[1], "la llamada usa el micrófono elegido");
    assert.deepEqual(errores, []);
    await ctx.close();
  });

  test("cada tanto renueva la sesión sin cortar la llamada, para que no se pierda el acento", async () => {
    await abrirLlamada();
    await page.evaluate(() => { T.voice.ajustes.renovarMs = 800; });
    await page.waitForFunction(() => document.querySelectorAll(".transcript .ln.c").length >= 1, null, { timeout: 8000 });
    await page.waitForTimeout(900);
    if (await page.locator(".typebar").isHidden()) await page.locator('button[aria-label="Escribir en vez de hablar"]').click();
    const campo = page.locator('.typebar input[aria-label="Tu respuesta"]');
    await campo.fill("Hola Agustina, contame qué pasa con los recordatorios.");
    await campo.press("Enter");
    await page.evaluate(() => window.__live.decir("Mirá, a los pacientes les llegan dos mensajes por cada turno.", 300));

    // Cuando el cliente termina de hablar, abre una sesión nueva en paralelo y le pasa el micrófono.
    await page.waitForFunction(() => window.__live.abiertos.length === 2 && window.__live.abiertos[0].readyState === 3, null, { timeout: 8000 });
    const [viejo, nuevo] = await page.evaluate(() => window.__live.abiertos.map(w => ({ mios: w.mios })));
    const consigna = nuevo.mios.find(m => m.setup).setup.systemInstruction.parts[0].text;
    assert.match(consigna, /LA LLAMADA YA ESTÁ EN CURSO/);
    assert.match(consigna, /dos mensajes por cada turno/, "le pasa lo hablado");
    assert.match(consigna, /TU ACENTO/);
    assert.equal(nuevo.mios.find(m => m.setup).setup.sessionResumption.handle, undefined, "es una sesión nueva, no la retomada");
    assert.ok(viejo.mios.some(m => m.realtimeInput && m.realtimeInput.audio));
    await page.waitForFunction(() => window.__live.abiertos[1].mios.some(m => m.realtimeInput && m.realtimeInput.audio), null, { timeout: 5000 });
    assert.equal(nuevo.mios.filter(m => m.realtimeInput && m.realtimeInput.text).length, 0, "la sesión nueva no saluda de nuevo");
    assert.doesNotMatch(await page.locator(".state-label").textContent(), /Conectando/);
    assert.equal(await page.locator(".notice").last().isVisible(), false, "no avisa ningún corte");

    // La charla sigue por la sesión nueva.
    await page.evaluate(() => window.__live.decir("Bueno, ¿y cuándo lo arreglan?", 200));
    await page.waitForFunction(() => /cuándo lo arreglan/.test(document.querySelector(".transcript").textContent), null, { timeout: 5000 });
    assert.deepEqual(errores, []);
    await page.context().close();
  });

  test("el ruido de línea suena solo mientras habla el cliente", async () => {
    await abrirLlamada({ atender: false });
    await page.evaluate(() => { const orig = T.voice.linea; T.voice.linea = s => (window.__linea = orig(s)); });
    await atenderEn(page);
    await page.waitForFunction(() => window.__linea && window.__linea.sonando, null, { timeout: 8000 });
    assert.equal(await estado(), "speaking", "suena mientras el cliente habla");
    await esperarEstado("listening");
    assert.equal(await page.evaluate(() => window.__linea.sonando), false, "en silencio, no");
    await page.evaluate(() => window.__live.decir("Sí, te escucho.", 300));
    await page.waitForFunction(() => window.__linea.sonando, null, { timeout: 5000 });
    await page.locator("#hang").click();
    await page.waitForFunction(() => window.__linea.parado, null, { timeout: 5000 });
    assert.deepEqual(errores, []);
    await page.context().close();
  });

  test("la voz del cliente pasa por el filtro telefónico, salvo que la empresa lo apague", async () => {
    await abrirLlamada();
    await esperarEstado("speaking");
    // El filtro de la voz, y el "bandpass" del ruido de línea que suena de fondo.
    assert.deepEqual((await page.evaluate(() => window.__audio.filtros)).sort(), ["bandpass", "highpass", "lowpass", "peaking"]);
    const setup = await page.evaluate(() => window.__live.enviados.find(m => m.setup).setup);
    assert.match(setup.systemInstruction.parts[0].text, /TU ACENTO/);
    assert.match(setup.systemInstruction.parts[0].text, /Tu acento rioplatense es igual en el último turno/);
    await page.context().close();
    await conEscenario(cfg => { cfg.vozTelefonica = false; }, async () => {
      await abrirLlamada();
      await esperarEstado("speaking");
      assert.deepEqual(await page.evaluate(() => window.__audio.filtros), []);
    });
  });

  test("conversación completa: setup, el cliente habla primero, transcripción, interrupción, colgar y evaluación", async () => {
    await abrirLlamada();

    // Conexión: token del servidor y setup con la consigna del escenario.
    await page.waitForFunction(() => window.__live.enviados.some(m => m.realtimeInput && m.realtimeInput.text));
    const { urls, setup, pie } = await page.evaluate(() => ({
      urls: window.__live.urls,
      setup: window.__live.enviados.find(m => m.setup).setup,
      pie: (window.__live.enviados.find(m => m.realtimeInput && m.realtimeInput.text) || {}).realtimeInput
    }));
    assert.equal(urls[0], "wss://falso.test/live?access_token=auth_tokens%2Ftoken-falso-123");
    assert.equal(setup.model, "models/gemini-test-live");
    assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
    assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore", "Agustina → voz femenina");
    assert.match(setup.systemInstruction.parts[0].text, /POR VOZ/);
    assert.match(setup.systemInstruction.parts[0].text, /herramienta colgar/);
    assert.ok(setup.inputAudioTranscription && setup.outputAudioTranscription, "transcripción de los dos lados");
    assert.equal(setup.tools[0].functionDeclarations[0].name, "colgar");
    assert.match(pie.text, /Hablá vos primero/, "el cliente habla primero");

    // El cliente saluda: se ve lo que dice y suena.
    await esperarEstado("speaking");
    await page.waitForFunction(() => /dos recordatorios/.test(document.querySelector(".caption").textContent));
    await esperarEstado("listening");
    assert.ok(await page.evaluate(() => window.__live.fuentes.terminadas >= 2), "se reprodujeron los dos pedazos de audio");

    // Micrófono: PCM 16 bits a 16 kHz en bloques de 40 ms (640 muestras = 1280 bytes).
    await page.waitForFunction(() => window.__live.enviados.some(m => m.realtimeInput && m.realtimeInput.audio));
    const audio = await page.evaluate(() => window.__live.enviados.find(m => m.realtimeInput && m.realtimeInput.audio).realtimeInput.audio);
    assert.equal(audio.mimeType, "audio/pcm;rate=16000");
    assert.equal(atob(audio.data).length, 1280);

    // El estudiante habla y el cliente contesta.
    await page.evaluate(() => { window.__live.escuchar("Hola Agustina, soy Lucas."); window.__live.escuchar(" Contame desde cuándo pasa."); });
    await page.waitForFunction(() => /Contame desde cuándo/.test(document.querySelectorAll(".caption")[1].textContent));
    await page.evaluate(() => window.__live.decir("Desde el lunes, más o menos. Y los pacientes se quejan, viste.", 400));
    await page.waitForFunction(() => document.querySelectorAll(".transcript .ln").length >= 3);

    // Interrupción: el cliente arranca algo largo y el estudiante le habla encima.
    await esperarEstado("listening");
    const antes = await page.evaluate(() => ({ ...window.__live.fuentes }));
    await page.evaluate(() => { window.__live.escuchar("Perfecto, ¿y pasa con todos los pacientes?"); window.__live.decir("Mirá, con todos no sé, pero el otro día una señora me llamó re enojada porque", 6000, { terminar: false }); });
    await esperarEstado("speaking");
    const t0 = Date.now();
    await page.evaluate(() => { window.__live.ws.servidor({ serverContent: { interrupted: true } }); });
    await esperarEstado("listening");
    assert.ok(Date.now() - t0 < 1000, "pasa a escuchar enseguida");
    const despues = await page.evaluate(() => ({ ...window.__live.fuentes }));
    assert.equal(despues.iniciadas - antes.iniciadas, 2);
    assert.equal(despues.cortadas - antes.cortadas, 2, "se cortó todo el audio del cliente que faltaba sonar");

    // Lo que alcanzó a decir queda en la transcripción.
    await page.waitForFunction(() => [...document.querySelectorAll(".transcript .ln")].some(l => /re enojada/.test(l.textContent)));

    // Tocar la esfera también lo corta.
    await page.evaluate(() => { window.__live.escuchar("Uy, entiendo."); window.__live.decir("Sí, y además me dijeron que lo iban a arreglar y nada, sigue igual, así que no sé qué hacer", 6000, { terminar: false }); });
    await esperarEstado("speaking");
    await page.locator(".orb.big").click({ force: true });   // la esfera late con el audio: nunca queda quieta
    await esperarEstado("listening");
    // El resto de esa respuesta que siga llegando se descarta.
    await page.evaluate(() => window.__live.decir("y esto no debería sonar", 400));
    await page.waitForTimeout(300);
    assert.equal(await estado(), "listening");

    // Despedida: el cliente llama a la herramienta colgar y la llamada termina sola.
    await page.evaluate(() => {
      window.__live.escuchar("Lo reviso hoy y te escribo a las tres con novedades.");
      window.__live.decir("Bueno, dale, espero tu mensaje. Gracias, chau.", 400, { terminar: false });
      window.__live.ws.servidor({ toolCall: { functionCalls: [{ id: "f1", name: "colgar", args: {} }] } });
    });
    await esperarVista("Informe");

    // La evaluación recibió la transcripción de los dos lados.
    const evalCall = app.fake.calls.find(c => c.payload.model === "gemini-test-eval");
    const enviado = JSON.stringify(evalCall.payload.messages);
    for (const frase of ["dos recordatorios", "Contame desde cuándo pasa", "Desde el lunes", "re enojada", "te escribo a las tres", "espero tu mensaje"]) {
      assert.ok(enviado.includes(frase), "falta en la evaluación: " + frase);
    }
    assert.ok(!/no debería sonar/.test(enviado), "lo descartado no entra en la transcripción");
    assert.ok(await page.evaluate(() => window.__live.abiertos.every(w => w.readyState === 3)), "se cerró la conexión");
    assert.deepEqual(errores, []);
    await page.context().close();
  });

  test("si Gemini Live no conecta, ofrece seguir con otra voz", async () => {
    const ctx = await browser.newContext({ locale: "es-AR", permissions: ["microphone"] });
    page = await ctx.newPage();
    errores = [];
    page.on("pageerror", e => errores.push(String(e)));
    await page.addInitScript(simularGeminiLive);
    await page.addInitScript(() => { window.__live.fallar = "API key not valid. Please pass a valid API key."; });
    await ingresarEn(page, app.base, "estudiante1");
    await page.locator(".card").first().click();
    await page.locator("#startCall").click();
    await atenderEn(page);
    const boton = page.locator("button", { hasText: "Seguir con otra voz" });
    await boton.waitFor({ timeout: 5000 });
    assert.match(await page.locator(".notice").last().innerText(), /rechazó la conexión de Gemini Live/);
    await boton.click();
    await esperarVista("Llamada en curso");
    // Sigue con la voz del navegador (Vapi no está configurado): ya no intenta Gemini Live.
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__live.urls.length), 1, "no reintenta Gemini Live");
    assert.equal(await page.locator("button", { hasText: "Seguir con otra voz" }).count(), 0);
    assert.deepEqual(errores, []);
    await ctx.close();
  });

  test("llamada entrante: la clienta no habla primero, espera que el candidato atienda", async () => {
    const cfg = configEjemplo();
    cfg.escenarios.find(e => /Viernes 19:30/.test(e.titulo)).inicio = "atiende";
    assert.equal((await pedir(app.base, "/api/empresa", { method: "PUT", json: cfg })).status, 200);
    try {
      await abrirLlamada();
      await page.waitForFunction(() => window.__live.enviados.some(m => m.setup));
      await esperarEstado("listening");
      await page.waitForTimeout(500);
      const pie = await page.evaluate(() => window.__live.enviados.filter(m => m.realtimeInput && m.realtimeInput.text).length);
      assert.equal(pie, 0, "no se manda el pie de arranque");
      assert.match(await page.locator(".state-label").textContent(), /saludá vos primero/);
      const setup = await page.evaluate(() => window.__live.enviados.find(m => m.setup).setup);
      assert.match(setup.systemInstruction.parts[0].text, /Esperá a que Lucas Ferreyra atienda y salude/);
      assert.deepEqual(errores, []);
      await page.context().close();
    } finally {
      await pedir(app.base, "/api/empresa", { method: "PUT", json: configEjemplo() });
    }
  });

  // ---------- Grabación de la llamada (solo si el candidato lo acepta) ----------
  // Una llamada corta: el cliente saluda, el candidato dice dos frases (que el evaluador de prueba cita en el
  // informe) y escribe una tercera con el teclado, y el cliente se despide y cuelga.
  async function llamadaConDosFrases() {
    await esperarEstado("speaking");
    await esperarEstado("listening");
    // Como el Gemini real: el texto del candidato llega recién cuando termina de hablar.
    await page.waitForTimeout(700);   // el candidato "habla" un rato: eso es lo que dura su turno en la grabación
    await page.evaluate(() => window.__live.escuchar("Entiendo, contame desde cuándo pasa y a cuántos pacientes afecta."));
    await page.waitForTimeout(300);   // y el cliente tarda un poco en contestar
    await page.evaluate(() => window.__live.decir("Desde el lunes, más o menos.", 400));
    await page.waitForFunction(() => document.querySelectorAll(".transcript .ln.u").length >= 1);
    await esperarEstado("listening");
    // Una frase escrita con el teclado: queda en la conversación, pero no tiene audio.
    await page.locator('button[aria-label="Escribir en vez de hablar"]').click();
    await page.locator('.typebar input[aria-label="Tu respuesta"]').fill("No voy a arreglar nada en producción a ciegas.");
    await page.locator('.typebar input[aria-label="Tu respuesta"]').press("Enter");
    await page.evaluate(() => window.__live.decir("Bueno, está bien.", 400));
    await page.waitForFunction(() => document.querySelectorAll(".transcript .ln.c").length >= 3);
    await esperarEstado("listening");
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__live.escuchar("Te escribo con lo que vaya pasando en una hora."));
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__live.decir("Dale, espero tu mensaje. Chau.", 400, { terminar: false });
      window.__live.ws.servidor({ toolCall: { functionCalls: [{ id: "f1", name: "colgar", args: {} }] } });
    });
    await esperarVista("Informe");
  }
  const ultimoInforme = async () => {
    const lista = (await pedir(app.base, "/api/informes")).cuerpo;
    return (await pedir(app.base, "/api/informes/" + lista[0].id)).cuerpo;
  };

  test("el brief ofrece grabar con la casilla sin marcar, y dice quién lo escucha y cuándo se borra", async () => {
    const ctx = await browser.newContext({ locale: "es-AR", permissions: ["microphone"] });
    page = await ctx.newPage();
    await ingresarEn(page, app.base, "estudiante1");
    await page.locator(".card", { hasText: "Viernes 19:30" }).click();
    await esperarVista("Simulación");
    assert.equal(await page.locator("#aceptaGrabacion").isChecked(), false, "arranca sin marcar");
    const texto = await page.locator(".grabacion").innerText();
    assert.match(texto, /opcional/i);
    assert.match(texto, /lo va a poder escuchar Nodo Software/);
    assert.match(texto, /Se borra a los 90 días/);
    assert.match(texto, /Si no aceptás, la simulación y el informe funcionan igual/);
    // La aceptación no se arrastra de una simulación a la otra: al volver al brief está sin marcar otra vez.
    await page.locator("#aceptaGrabacion").check();
    await page.locator("button", { hasText: "Volver" }).click();
    await page.locator(".card", { hasText: "Viernes 19:30" }).click();
    await esperarVista("Simulación");
    assert.equal(await page.locator("#aceptaGrabacion").isChecked(), false);
    await ctx.close();
  });

  test("sin aceptar la grabación: no se graba, no se sube nada y el informe no tiene audio", async () => {
    await abrirLlamada();
    const subidas = [];
    page.on("request", r => { if (/\/audio/.test(r.url())) subidas.push(r.method() + " " + r.url()); });
    assert.ok(await page.locator(".grabando").isHidden(), "no dice que está grabando");
    await llamadaConDosFrases();

    assert.equal(await page.evaluate(() => window.__audio.grabaciones), 0, "no se armó ninguna grabación");
    assert.deepEqual(subidas, [], "no se pidió nada de audio al servidor");
    assert.equal(await page.locator(".escuchar").count(), 0, "el informe no tiene botones para escuchar");
    const r = await ultimoInforme();
    assert.equal(r.consentimientoAudio.aceptado, false, "queda anotado que no aceptó");
    assert.equal(r.audio, undefined);
    assert.ok(r.transcripcion.length >= 5);
    assert.ok(r.transcripcion.every(t => t.t0 === undefined && t.t1 === undefined), "sin grabación, los turnos no llevan tiempos");
    assert.equal(fs.existsSync(path.join(app.dataDir, "audios")), false, "no se creó ni la carpeta de audios");
    assert.deepEqual(errores, []);
    await page.context().close();
  });

  test("aceptando la grabación: se graba la llamada, el audio queda en el informe y cada cita hablada se puede escuchar", async () => {
    await abrirLlamada({ grabar: true });
    await page.locator(".grabando").waitFor({ timeout: 5000 });
    await llamadaConDosFrases();
    assert.equal(await page.evaluate(() => window.__audio.grabaciones), 1, "una sola grabación para toda la llamada");

    // En el servidor: la aceptación con el texto que leyó, el audio guardado y los tiempos de cada turno hablado.
    const r = await ultimoInforme();
    assert.equal(r.consentimientoAudio.aceptado, true);
    assert.equal(r.consentimientoAudio.version, "2026-11-11");
    assert.match(r.consentimientoAudio.texto, /Se borra a los 90 días/);
    assert.match(r.consentimientoAudio.texto, /Acepto que se grabe el audio de esta simulación\./);
    assert.ok(r.consentimientoAudio.registrado, "con la fecha del servidor");
    assert.equal(r.audio.mime, "audio/webm");
    assert.ok(r.audio.bytes > 2000, "bytes: " + r.audio.bytes);
    assert.ok(r.audio.duracionSeg >= 2, "duración: " + r.audio.duracionSeg);
    const guardado = fs.readFileSync(path.join(app.dataDir, "audios", r.id + ".webm"));
    assert.equal(guardado.length, r.audio.bytes);
    assert.deepEqual([...guardado.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], "es un archivo WebM de verdad");

    const hablados = r.transcripcion.filter(t => t.role === "user" && t.t1 !== undefined);
    assert.deepEqual(hablados.map(t => t.text), ["Entiendo, contame desde cuándo pasa y a cuántos pacientes afecta.", "Te escribo con lo que vaya pasando en una hora."]);
    const escrito = r.transcripcion.find(t => /a ciegas/.test(t.text));
    assert.equal(escrito.t0, undefined, "lo escrito con el teclado no tiene audio");
    for (const t of r.transcripcion.filter(x => x.t1 !== undefined)) assert.ok(t.t0 >= 0 && t.t0 < t.t1 && t.t1 <= r.audio.duracionSeg + 1, JSON.stringify(t));
    assert.ok(hablados[0].t1 <= hablados[1].t0, "los turnos quedan en orden en la grabación");
    // El texto del candidato llega cuando termina de hablar: su turno no empieza ahí, sino donde terminó el anterior.
    const conTiempos = r.transcripcion.filter(t => t.t1 !== undefined);
    for (const t of hablados) {
      const anterior = conTiempos[conTiempos.indexOf(t) - 1];
      assert.equal(t.t0, anterior ? anterior.t1 : 0, "empieza donde terminó el turno anterior: " + JSON.stringify(t));
    }
    assert.ok(r.transcripcion.filter(t => t.role === "assistant").every(t => t.t0 < t.t1), "los turnos del cliente también tienen tiempos");

    // El archivo guardado se puede decodificar, dura lo que dice y tiene la voz del cliente donde dicen los tiempos:
    // en el tramo de su primer turno hay sonido (el tono que manda el Gemini simulado).
    const saludo = r.transcripcion.find(t => t.role === "assistant");
    const sonido = await page.evaluate(async ({ id, t0, t1 }) => {
      const datos = await (await fetch(`/api/informes/${id}/audio`)).arrayBuffer();
      const ctx = new AudioContext({ sampleRate: 16000 });
      const audio = await ctx.decodeAudioData(datos);
      const x = audio.getChannelData(0);
      const volumen = (desde, hasta) => { let e = 0, n = 0; for (let i = Math.floor(desde * 16000); i < Math.min(x.length, Math.floor(hasta * 16000)); i++) { e += x[i] * x[i]; n++; } return n ? Math.sqrt(e / n) : 0; };
      await ctx.close();
      return { duracion: audio.duration, canales: audio.numberOfChannels, enElSaludo: volumen(t0, t1) };
    }, { id: r.id, t0: saludo.t0, t1: saludo.t1 });
    assert.equal(sonido.canales, 1, "se graba en un solo canal");
    assert.ok(Math.abs(sonido.duracion - r.audio.duracionSeg) < 1.5, `el archivo dura ${sonido.duracion} y el informe dice ${r.audio.duracionSeg}`);
    assert.ok(sonido.enElSaludo > 0.02, "volumen de la voz del cliente en su turno: " + sonido.enElSaludo);

    // En el informe: un botón por cada cita que el candidato dijo hablando (dos de las siete del evaluador de prueba).
    assert.equal(await page.locator(".escuchar").count(), 2);
    assert.match(await page.locator(".r-audio").innerText(), /Tocá el botón junto a una cita/);
    const citas = await page.locator(".crit .ev:has(.escuchar)").allInnerTexts();
    assert.match(citas[0], /contame desde cuándo pasa/);
    assert.match(citas[1], /Te escribo con lo que vaya pasando/);
    assert.equal(await page.locator(".crit .ev", { hasText: "a ciegas" }).locator(".escuchar").count(), 0, "la cita escrita con el teclado no tiene botón");

    // Al tocarlo suena la parte hablada de ese turno (sin los silencios), con un margen a cada lado,
    // y no otra parte de la llamada.
    const boton = page.locator(".escuchar").nth(1);
    await boton.click();
    await page.waitForFunction(() => document.querySelectorAll(".escuchar")[1].classList.contains("on"));
    await page.waitForFunction(() => window.__live.ultimoInicio && window.__live.ultimoInicio.length === 3);
    const [, desde, cuanto] = await page.evaluate(() => window.__live.ultimoInicio);
    const turno = hablados[1];
    assert.ok(desde >= Math.max(0, turno.t0 - 1) - 0.05, `arranca en ${desde}, el turno empieza en ${turno.t0}`);
    assert.ok(cuanto > 0.1 && desde + cuanto <= turno.t1 + 1.05 && desde + cuanto > turno.t0, `suena hasta ${desde + cuanto}, el turno termina en ${turno.t1}`);
    assert.equal(await boton.getAttribute("aria-pressed"), "true");
    // Tocarlo de nuevo lo frena.
    await boton.click();
    await page.waitForFunction(() => !document.querySelectorAll(".escuchar")[1].classList.contains("on"));

    // Mientras suena, las palabras de esa cita se van iluminando; al terminar sola, vuelven todas al gris.
    const cita = page.locator(".crit .ev:has(.escuchar)").nth(1);
    assert.equal(await cita.locator(".palabra").count(), 10, "una por palabra de «Te escribo con lo que vaya pasando en una hora.»");
    assert.equal(await page.locator(".palabra.dicha").count(), 0);
    await boton.click();
    await cita.locator(".palabra.dicha").first().waitFor({ timeout: 5000 });
    assert.equal(await page.locator(".crit .ev:has(.escuchar)").nth(0).locator(".palabra.dicha").count(), 0, "solo se ilumina la cita que suena");
    await page.waitForFunction(() => !document.querySelectorAll(".escuchar")[1].classList.contains("on"), null, { timeout: 15000 });
    assert.equal(await page.locator(".palabra.dicha").count(), 0);

    // Tocar otro mientras suena uno: frena el primero y suena el segundo.
    await page.locator(".escuchar").nth(0).click();
    await page.waitForFunction(() => document.querySelectorAll(".escuchar")[0].classList.contains("on"));
    await page.locator(".escuchar").nth(1).click();
    await page.waitForFunction(() => { const b = document.querySelectorAll(".escuchar"); return !b[0].classList.contains("on") && b[1].classList.contains("on"); });

    // La empresa también lo escucha desde el mismo informe.
    const empresa = await (await browser.newContext({ locale: "es-AR" })).newPage();
    await ingresarEn(empresa, app.base, "empresa1");
    await empresa.locator(".informes-lista .list button").first().click();
    await empresa.locator(".escuchar").first().waitFor();
    assert.equal(await empresa.locator(".escuchar").count(), 2);
    await empresa.context().close();

    assert.deepEqual(errores, []);
    await page.context().close();
  });

  test("en una llamada entrante no se graba mientras suena el teléfono: recién al atender", () =>
    conEscenario((cfg, e) => { e.inicio = "atiende"; }, async () => {
      await abrirLlamada({ atender: false, grabar: true });
      await page.waitForFunction(() => !document.querySelector("#atender").disabled, null, { timeout: 5000 });
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => window.__audio.grabaciones), 0, "la voz ya conectó, pero todavía no se graba");
      assert.ok(await page.locator(".grabando").isHidden());
      await page.locator("#atender").click();
      await page.waitForFunction(() => window.__audio.grabaciones === 1, null, { timeout: 5000 });
      await page.locator(".grabando").waitFor({ timeout: 5000 });
      await page.locator("#hang").click();
      await esperarVista("Llamada muy corta");
    }));

  test("una llamada demasiado corta no deja ninguna grabación guardada", async () => {
    const antes = fs.readdirSync(path.join(app.dataDir, "audios")).length;
    await abrirLlamada({ grabar: true });
    await page.locator(".grabando").waitFor({ timeout: 5000 });
    await esperarEstado("listening");
    await page.locator("#hang").click();
    await esperarVista("Llamada muy corta");
    await page.waitForTimeout(500);
    assert.equal(fs.readdirSync(path.join(app.dataDir, "audios")).length, antes);
    assert.deepEqual(errores, []);
    await page.context().close();
  });

  test("Colgar corta la llamada y libera la conexión", async () => {
    await abrirLlamada();
    await esperarEstado("listening");
    await page.locator("#hang").click();
    await esperarVista("Llamada muy corta");
    assert.ok(await page.evaluate(() => window.__live.abiertos.every(w => w.readyState === 3)));
    assert.deepEqual(errores, []);
    await page.context().close();
  });
});
