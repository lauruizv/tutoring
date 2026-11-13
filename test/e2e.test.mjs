/* Recorrido completo de la app en un navegador de verdad, con la API de IA falsa.
   Cubre: inicio del estudiante, llamada escribiendo en vez de hablar, evaluación,
   informe, chat del junior y edición en el panel de empresa.

   Necesita Playwright (dependencia solo de desarrollo):
       npm install
       npx playwright install chromium
       npm run test:e2e

   Si Playwright no está instalado, las pruebas se saltean con un aviso en vez de fallar. */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApp, pedir, ingresarEn, salirEn, CLAVE_PRUEBA, configEjemplo, atenderEn, vozSimuladaEn, vozSimuladaDe, vozRealEn } from "./helpers.mjs";

let chromium = null;
try { ({ chromium } = await import("playwright")); } catch (_) {}

const saltear = chromium
  ? false
  : "Falta Playwright: corré `npm install` y `npx playwright install chromium`.";

describe("recorrido completo en el navegador", { skip: saltear }, () => {
  let app, browser, page;

  before(async () => {
    app = await startApp({ provider: "gemini" });
    browser = await chromium.launch();
    const ctx = await browser.newContext({ locale: "es-AR" });
    page = await ctx.newPage();
    page.on("dialog", d => d.accept());          // beforeunload al recargar durante una llamada
    errores = [];
    page.on("pageerror", e => errores.push(String(e)));
    consola = [];
    page.on("console", m => consola.push(m.text()));
    // Esperados: el 404 de /api/empresa la primera vez (todavía no hay configuración guardada),
    // el 401 de /api/yo al abrir sin sesión y el de /api/login con la clave incorrecta.
    page.on("console", m => {
      const url = (m.location() && m.location().url) || "";
      if (m.type() === "error" && !/favicon|\/api\/(empresa|yo|login)/.test(url + " " + m.text())) errores.push(m.text() + " @ " + url);
    });
    await page.goto(app.base);
  });
  after(async () => {
    if (browser) await browser.close();
    if (app) await app.stop();
  });

  let errores = [], consola = [];
  const esperarVista = etiqueta => page.waitForFunction(t => document.getElementById("viewLabel").textContent === t, etiqueta, { timeout: 15000 });

  test("sin sesión se ve el formulario de ingreso, sin barra lateral", async () => {
    await page.locator("#loginUsuario").waitFor();
    assert.equal(await page.locator("#side").isVisible(), false);
  });

  test("con la clave incorrecta avisa en el formulario", async () => {
    await page.locator("#loginUsuario").fill("estudiante1");
    await page.locator("#loginClave").fill("no-es-esta");
    await page.locator("#loginEntrar").click();
    await page.getByText("Usuario o contraseña incorrectos.").waitFor();
  });

  test("el candidato entra a Simulaciones con su nombre y sin selector de perfil", async () => {
    await ingresarEn(page, app.base, "estudiante1");
    await esperarVista("Simulaciones por voz");
    await page.waitForSelector(".card");
    assert.equal(await page.locator("#meName").textContent(), "Lucas Ferreyra");
    assert.equal(await page.locator("#meRole").textContent(), "Candidato");
    assert.equal(await page.locator(".seg").count(), 0);
    assert.equal(await page.locator("#candidato").count(), 0);
    assert.equal(await page.evaluate(() => document.body.dataset.rol), "estudiante");
  });

  test("estudiante: la pantalla de inicio muestra los escenarios y el estado de la IA", async () => {
    // El estado de la IA no se muestra en pantalla: queda en la consola del navegador.
    assert.ok(consola.includes("[IA] IA conectada · Gemini"), "falta el estado de la IA en la consola");
    assert.equal(await page.locator(".card").count(), 6);
    await assert.doesNotReject(page.locator(".card b", { hasText: "Viernes 19:30: los recordatorios no salieron" }).waitFor());
  });

  test("estudiante: el brief explica con quién habla y cuál es el objetivo", async () => {
    await page.locator(".card", { hasText: "Viernes 19:30" }).click();
    await esperarVista("Simulación");
    const texto = await page.locator(".brief").innerText();
    assert.match(texto, /Agustina Ferrari/i);
    assert.match(texto, /Viernes a la noche/i, "el brief muestra el resumen de la situación");
    assert.doesNotMatch(texto, /tu objetivo/i, "el objetivo no se muestra antes de la llamada");
    assert.equal(await page.locator("#startCall").isEnabled(), true);
    // Con la voz del navegador no se elige dispositivo: se prueba con los del sistema.
    const audio = await page.locator(".audio").innerText();
    assert.match(audio, /probá tu audio/i);
    assert.match(audio, /El del sistema/);
    assert.equal(await page.locator("button", { hasText: "Probar micrófono" }).isVisible(), true);
  });

  test("la llamada arranca, habla el cliente y se puede responder escribiendo", async () => {
    await page.locator("#startCall").click();
    await atenderEn(page);
    await esperarVista("Llamada en curso");
    assert.equal(await page.locator('button[aria-label="Lo que tenés a mano"]').count(), 0, "sin ficha en el escenario no hay botón");
    // El cliente simulado abre la conversación.
    await page.waitForFunction(() => /dos mensajes por cada turno/.test(document.querySelector(".caption").textContent), null, { timeout: 15000 });

    // Sin micrófono el motor avisa y abre el teclado solo; igual lo abrimos por las dudas.
    if (await page.locator(".typebar").isHidden()) await page.locator('button[aria-label="Escribir en vez de hablar"]').click();
    const campo = page.locator('.typebar input[aria-label="Tu respuesta"]');
    await campo.fill("Buen día Agustina, contame desde cuándo pasa y a cuántos pacientes les pasa.");
    await campo.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".transcript .ln").length >= 3, null, { timeout: 15000 });

    await campo.fill("Entiendo. Lo reviso con el equipo y te aviso hoy a las tres.");
    await campo.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".transcript .ln").length >= 5, null, { timeout: 15000 });

    const turnos = await page.locator(".transcript .ln").evaluateAll(ns => ns.map(n => n.className));
    // La conversación alterna cliente/candidato.
    assert.ok(turnos.filter(c => c.includes("u")).length >= 2, "faltan turnos del candidato");
    assert.ok(turnos.filter(c => c.includes("c")).length >= 2, "faltan turnos del cliente");
  });

  test("colgar dispara la evaluación y deja un informe con puntaje y evidencia", async () => {
    await page.locator("#hang").click();
    await esperarVista("Informe");

    assert.equal(await page.locator(".ring .n b").textContent(), "81");
    const criterios = await page.locator(".crit .nm").evaluateAll(ns => ns.map(n => n.firstChild.textContent));
    assert.deepEqual(criterios, ["Escucha y claridad", "Empatía y contención", "Cierre y próximos pasos", "Criterio y autonomía", "Receptividad", "Curiosidad", "Iniciativa"]);

    const evidencias = await page.locator(".crit .ev").allTextContents();
    assert.equal(evidencias.length, 7, "cada criterio tiene que mostrar evidencia");
    assert.match(evidencias[0], /Entiendo, contame desde cuándo pasa/);

    const aviso = await page.locator(".disclaimer").textContent();
    assert.match(aviso, /no recomienda contratar ni descartar/);
    assert.equal(await page.locator(".report .notice").count(), 0, "no debería avisar criterios sin puntuar");
  });

  test("el informe quedó guardado en el servidor y se ve en la lista", async () => {
    const { cuerpo } = await pedir(app.base, "/api/informes");
    assert.equal(cuerpo.length, 1);
    assert.equal(cuerpo[0].candidato, "Lucas Ferreyra");
    assert.equal(cuerpo[0].puntaje, 81);

    await page.locator('.nav button:has-text("Mis informes")').click();
    await esperarVista("Mis informes");
    await page.locator(".list button").first().waitFor();   // la lista llega del servidor
    assert.equal(await page.locator(".list button").count(), 1);
    assert.equal(await page.locator(".score-chip").textContent(), "81/100");
  });

  test("junior: el mentor responde con los bloques [Cómo se hace] [Por qué importa] [Cómo lo hacemos acá] [Tu turno]", async () => {
    await salirEn(page);
    await ingresarEn(page, app.base, "junior1");
    await esperarVista("Mentor del equipo");
    assert.equal(await page.locator("#meName").textContent(), "Camila Ruiz");
    await page.locator(".card", { hasText: "Resolver una tarea" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".thread .blk").length >= 4, null, { timeout: 15000 });

    const etiquetas = await page.locator(".thread .blk .lbl").allTextContents();
    assert.deepEqual(etiquetas, ["Cómo se hace", "Por qué importa", "Cómo lo hacemos acá", "Tu turno"]);
    assert.match(await page.locator(".thread .u").first().textContent(), /TF-142/);
    assert.match(await page.locator("#ctxLine").textContent(), /Nodo Software/);
  });

  test("junior: se puede seguir la conversación escribiendo", async () => {
    await page.locator("#input").fill("¿Por qué se duplican si el worker corre en dos réplicas?");
    await page.locator("#send").click();
    await page.waitForFunction(() => document.querySelectorAll(".thread .blk").length >= 8, null, { timeout: 15000 });
    assert.equal(await page.locator(".thread .u").count(), 2);
    assert.equal(await page.locator(".thread .err").count(), 0, "no tendría que haber errores");
  });

  test("empresa: el senior edita el contexto y se guarda en el servidor", async () => {
    await salirEn(page);
    await ingresarEn(page, app.base, "empresa1");
    await esperarVista("Informes de candidatos");
    await page.locator('.nav button:has-text("Contexto")').click();
    await esperarVista("Contexto de la empresa");
    assert.equal(await page.locator("#saveCfg").isDisabled(), true, "sin cambios el botón está apagado");

    await page.locator(".cfg .grid2 input").first().fill("Nodo Software SRL");
    assert.equal(await page.locator("#saveCfg").isDisabled(), false);
    assert.equal(await page.locator(".dirty").isVisible(), true);
    await page.locator("#saveCfg").click();
    await page.waitForFunction(() => /Configuración guardada/.test(document.getElementById("toast").textContent), null, { timeout: 10000 });

    const { cuerpo } = await pedir(app.base, "/api/empresa");
    assert.equal(cuerpo.empresa, "Nodo Software SRL");

    // Se vuelve al nombre original: la lista de informes solo muestra los de la empresa con el nombre actual.
    await page.locator(".cfg .grid2 input").first().fill("Nodo Software");
    await page.locator("#saveCfg").click();
    await page.waitForFunction(() => document.getElementById("saveCfg").disabled, null, { timeout: 10000 });
    assert.equal((await pedir(app.base, "/api/empresa")).cuerpo.empresa, "Nodo Software");
  });

  test("empresa: se edita un escenario y un criterio, y quedan guardados", async () => {
    await page.locator('.nav button:has-text("Escenarios")').click();
    await esperarVista("Escenarios de simulación");
    await page.locator(".acc-h").first().click();
    await page.locator(".acc-b input").first().fill("Un compañero bloquea tu ticket (editado)");
    await page.locator("#saveCfg").click();
    await page.waitForFunction(() => /Configuración guardada/.test(document.getElementById("toast").textContent), null, { timeout: 10000 });

    await page.locator('.nav button:has-text("Criterios")').click();
    await esperarVista("Criterios de evaluación");
    await page.locator(".crit-row select").first().selectOption("1");
    await page.locator("#saveCfg").click();
    await page.waitForFunction(() => /Configuración guardada/.test(document.getElementById("toast").textContent), null, { timeout: 10000 });

    const { cuerpo } = await pedir(app.base, "/api/empresa");
    assert.equal(cuerpo.escenarios[0].titulo, "Un compañero bloquea tu ticket (editado)");
    assert.equal(cuerpo.criterios[0].peso, 1);
  });

  test("empresa: ve el informe del candidato y lo puede eliminar", async () => {
    await page.locator('.nav button:has-text("Informes")').click();
    await esperarVista("Informes de candidatos");
    await page.locator(".list button").first().waitFor();   // la lista llega del servidor
    assert.equal(await page.locator(".list button").count(), 1);
    await page.locator(".list button").first().click();
    await esperarVista("Informe");
    assert.equal(await page.locator('button:has-text("Eliminar")').count(), 1);

    await page.locator('button:has-text("Eliminar")').click();
    await esperarVista("Informes de candidatos");
    const { cuerpo } = await pedir(app.base, "/api/informes");
    assert.equal(cuerpo.length, 0);
  });

  test("interrumpir al cliente lo corta y pasa a escuchar", async () => {
    await salirEn(page);
    await ingresarEn(page, app.base, "estudiante1");
    await esperarVista("Simulaciones por voz");
    await page.locator(".card").first().click();
    await esperarVista("Simulación");
    // Con una voz simulada, para que no dependa de las voces del sistema (el Chromium de Linux no trae ninguna).
    await vozSimuladaEn(page);
    try {
      await page.locator("#startCall").click();
      await atenderEn(page);
      await esperarVista("Llamada en curso");
      await page.waitForFunction(() => /hablando/.test(document.querySelector(".state-label").textContent), null, { timeout: 15000 });
      const antes = await vozSimuladaDe(page);
      assert.ok(antes.hablando && antes.dichos.length >= 1, "el cliente está hablando");
      assert.equal(antes.cortes, 0);

      // force: la esfera late mientras el cliente habla y Playwright esperaría a que se quede quieta,
      // o sea, a que termine de hablar solo: el clic llegaría tarde y no interrumpiría nada.
      await page.locator(".orb.big").click({ force: true });
      await page.waitForFunction(() => /Te escucho|silenciado/.test(document.querySelector(".state-label").textContent), null, { timeout: 10000 });
      const despues = await vozSimuladaDe(page);
      assert.equal(despues.hablando, false, "la voz se calló");
      assert.equal(despues.cortes, 1, "se cortó la voz una vez");
      // Lo que alcanzó a decir queda en la transcripción: no se pierde para la evaluación.
      assert.ok(await page.locator(".transcript .ln.c").count() >= 1);
    } finally { await vozRealEn(page); }
  });

  test("si el cliente se despide con [FIN], la llamada se cierra sola", async () => {
    if (await page.locator(".typebar").isHidden()) await page.locator('button[aria-label="Escribir en vez de hablar"]').click();
    const campo = page.locator('.typebar input[aria-label="Tu respuesta"]');
    // Hacen falta al menos dos respuestas del candidato para que se arme el informe.
    await campo.fill("Entiendo, Agustina. ¿Pasa con WhatsApp o también con email?");
    await campo.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".transcript .ln.u").length >= 1, null, { timeout: 15000 });
    await campo.fill("Te aviso hoy a las tres, Agustina. DECI:Perfecto, quedo a la espera. Gracias, hasta luego. [FIN]");
    await campo.press("Enter");
    // Al detectar [FIN] cuelga solo y arranca la evaluación.
    await esperarVista("Informe");
    // Antes se bajó el peso del primer criterio (de 15 a 1), por eso no da igual que el primer informe.
    assert.equal(await page.locator(".ring .n b").textContent(), "80");
    // El [FIN] no tiene que quedar escrito en la transcripción del informe.
    const conversacion = await page.locator("details.tx").innerText();
    assert.ok(!/\[FIN\]/.test(conversacion.replace(/DECI:.*/g, "")), "el [FIN] no debería mostrarse");
  });

  test("a 400 px de ancho no se desborda ninguna pantalla", async () => {
    await page.setViewportSize({ width: 400, height: 820 });
    const vistas = [["estudiante1", "Simulaciones por voz"], ["junior1", "Mentor del equipo"], ["empresa1", "Informes de candidatos"]];
    const desborde = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const [usuario, etiqueta] of vistas) {
      // En pantallas chicas la tarjeta del usuario está en el menú lateral: salirEn lo abre.
      await salirEn(page);
      assert.equal(await desborde(), 0, "el formulario de ingreso se desborda a lo ancho");
      await ingresarEn(page, app.base, usuario);
      await esperarVista(etiqueta);
      assert.equal(await desborde(), 0, `${etiqueta} se desborda a lo ancho`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("no hubo errores de JavaScript en toda la corrida", () => {
    assert.deepEqual(errores, []);
  });
});

describe("ingreso y sesión en el navegador", { skip: saltear }, () => {
  let app, browser;
  before(async () => { app = await startApp({ provider: "gemini" }); browser = await chromium.launch(); });
  after(async () => { if (browser) await browser.close(); if (app) await app.stop(); });
  const nuevaPagina = async () => (await browser.newContext({ locale: "es-AR" })).newPage();
  const vista = (page, t) => page.waitForFunction(t => document.getElementById("viewLabel").textContent === t, t, { timeout: 15000 });

  test("quien entra con el código inicial crea su contraseña y llega a su pantalla", async () => {
    const page = await nuevaPagina();
    await page.goto(app.base);
    await page.locator("#loginUsuario").fill("nuevo1");
    await page.locator("#loginClave").fill(app.codigoNuevo);
    await page.locator("#loginEntrar").click();
    await page.locator("#claveNueva").waitFor();
    assert.equal(await page.locator("#side").isVisible(), false);
    await page.locator("#claveNueva").fill("corta");
    await page.locator("#claveRepetir").fill("corta");
    await page.locator("#claveGuardar").click();
    await page.getByText(/al menos 8 caracteres/).last().waitFor();
    await page.locator("#claveNueva").fill("mi-clave-segura");
    await page.locator("#claveRepetir").fill("otra-cosa-distinta");
    await page.locator("#claveGuardar").click();
    await page.getByText("Las dos contraseñas no coinciden.").waitFor();
    await page.locator("#claveRepetir").fill("mi-clave-segura");
    await page.locator("#claveGuardar").click();
    await vista(page, "Simulaciones por voz");
    assert.equal(await page.locator("#meName").textContent(), "Nico Nuevo");
  });

  test("si la sesión se cierra en otro lado, la próxima acción lleva al ingreso con aviso", async () => {
    const page = await nuevaPagina();
    await ingresarEn(page, app.base, "empresa1");
    await vista(page, "Informes de candidatos");
    await page.request.post(app.base + "/api/logout");
    await page.locator('.nav button:has-text("Informes")').click();
    await page.getByText("Tu sesión venció. Volvé a ingresar.").waitFor();
    assert.equal(await page.locator("#loginUsuario").isVisible(), true);
  });

  test("Cambiar contraseña desde la cuenta pide la actual", async () => {
    const page = await nuevaPagina();
    await ingresarEn(page, app.base, "junior1");
    await page.locator("#me").click();
    await page.locator("#cuenta").click();
    await vista(page, "Tu cuenta");
    await page.locator("#claveActual").fill(CLAVE_PRUEBA);
    await page.locator("#claveNueva").fill("clave-junior-nueva");
    await page.locator("#claveRepetir").fill("clave-junior-nueva");
    await page.locator("#claveGuardar").click();
    await page.getByText("Listo: tu contraseña cambió.").waitFor();
  });

  test("cada rol tiene su color", async () => {
    const page = await nuevaPagina();
    await ingresarEn(page, app.base, "empresa1");
    const empresa = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--lav").trim());
    await salirEn(page);
    await ingresarEn(page, app.base, "estudiante1");
    const estudiante = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--lav").trim());
    assert.notEqual(empresa, estudiante);
  });
});

describe("llamada entrante con la voz del navegador", { skip: saltear }, () => {
  let app, browser;
  before(async () => {
    app = await startApp({ provider: "gemini" });
    const cfg = configEjemplo();
    cfg.escenarios.find(e => /Viernes 19:30/.test(e.titulo)).inicio = "atiende";
    await pedir(app.base, "/api/empresa", { method: "PUT", json: cfg });
    browser = await chromium.launch();
  });
  after(async () => { if (browser) await browser.close(); if (app) await app.stop(); });

  test("el candidato atiende y saluda primero; recién ahí habla la clienta", async () => {
    const page = await (await browser.newContext({ locale: "es-AR" })).newPage();
    page.on("dialog", d => d.accept());
    await ingresarEn(page, app.base, "estudiante1");
    await page.locator(".card", { hasText: "Viernes 19:30" }).click();
    assert.match(await page.locator(".brief").innerText(), /atendés vos/);
    await page.locator("#startCall").click();
    await atenderEn(page);
    await page.waitForFunction(() => /saludá vos primero/.test(document.querySelector(".state-label").textContent), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    assert.equal(await page.locator(".transcript .ln").count(), 0, "la clienta no habló todavía");
    if (await page.locator(".typebar").isHidden()) await page.locator('button[aria-label="Escribir en vez de hablar"]').click();
    const campo = page.locator('.typebar input[aria-label="Tu respuesta"]');
    await campo.fill("Nodo Software, buen día, te habla Lucas. ¿En qué te puedo ayudar?");
    await campo.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".transcript .ln.c").length >= 1, null, { timeout: 15000 });
    const roles = await page.locator(".transcript .ln").evaluateAll(ns => ns.map(n => n.classList.contains("u") ? "u" : "c"));
    assert.equal(roles[0], "u", "el primer turno es del candidato");
  });
});

describe("ejemplo MKT Contact Center", { skip: saltear }, () => {
  let app, browser;
  before(async () => { app = await startApp({ provider: "gemini" }); browser = await chromium.launch(); });
  after(async () => { if (browser) await browser.close(); if (app) await app.stop(); });

  test("la empresa lo carga desde Contexto y el candidato ve los escenarios de call center", async () => {
    const empresa = await (await browser.newContext({ locale: "es-AR" })).newPage();
    empresa.on("dialog", d => d.accept());
    await ingresarEn(empresa, app.base, "empresa1");
    await empresa.locator('.nav button:has-text("Contexto")').click();
    await empresa.locator('select[aria-label="Empresa de ejemplo"]').selectOption("mkt");
    await empresa.locator("button", { hasText: "Cargar ejemplo" }).click();
    await empresa.waitForFunction(() => /MKT Contact Center/.test(document.getElementById("toast").textContent), null, { timeout: 10000 });
    assert.equal((await pedir(app.base, "/api/empresa")).cuerpo.empresa, "MKT Contact Center");

    const page = await (await browser.newContext({ locale: "es-AR" })).newPage();
    await ingresarEn(page, app.base, "estudiante1");
    await page.locator(".card", { hasText: "Hace dos días que no tengo internet" }).waitFor();
    assert.equal(await page.locator(".card").count(), 6);
    await page.locator(".card", { hasText: "Llamada de cobranza" }).click();
    assert.match(await page.locator(".brief").innerText(), /llamás vos/i);
    const brief = await page.locator(".brief").innerText();
    assert.match(brief, /lo que tenés a mano/i);
    assert.match(brief, /38\.000/, "el monto de la deuda está antes de llamar");
    assert.match(brief, /DNI y la fecha de nacimiento/);
    assert.match(brief, /33\.221\.004/, "en la saliente el operador ve el DNI: se lo dice al cliente para que confirme");
    await page.locator("button", { hasText: "Volver" }).click();
    await page.locator(".card", { hasText: "Hace dos días que no tengo internet" }).click();
    assert.doesNotMatch(await page.locator(".brief").innerText(), /\d{1,2}\.\d{3}\.\d{3}/, "en la entrante el DNI no: se lo tiene que pedir");
  });

  test("durante la llamada, \"Lo que tenés a mano\" se abre, copia un dato, se cierra con Esc y recuerda cómo quedó", async () => {
    const ctx = await browser.newContext({ locale: "es-AR", permissions: ["clipboard-read", "clipboard-write"] });
    const page = await ctx.newPage();
    await ingresarEn(page, app.base, "estudiante1");
    const llamar = async () => {
      await page.locator(".card", { hasText: "Llamada de cobranza" }).click();
      await page.locator("#startCall").click();
      await atenderEn(page);
    };
    await llamar();
    const boton = page.locator('button[aria-label="Lo que tenés a mano"]');
    const panel = page.locator(".ficha-panel");
    await boton.waitFor();
    assert.ok(await panel.isHidden(), "arranca cerrado");

    await boton.click();
    assert.equal(await boton.getAttribute("aria-expanded"), "true");
    assert.match(await panel.innerText(), /38\.000/, "el monto de la deuda está a mano durante la llamada");
    await panel.locator("li", { hasText: "8812-461" }).locator("button.copiar").click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /8812-461/, "copia el número de gestión");

    await page.keyboard.press("Escape");
    assert.ok(await panel.isHidden(), "Esc lo cierra");
    assert.equal(await boton.getAttribute("aria-expanded"), "false");

    // Abierto al salir: en la próxima llamada arranca abierto.
    await boton.click();
    await page.goto(app.base);
    await llamar();
    await panel.waitFor();
    assert.ok(await panel.isVisible(), "recuerda que lo dejó abierto");
    await ctx.close();
  });

  test("si los escenarios se cargaron antes de que existiera \"Lo que tenés a mano\", igual aparece", async () => {
    const cfg = (await pedir(app.base, "/api/empresa")).cuerpo;
    cfg.escenarios.forEach(e => { delete e.ficha; });
    cfg.escenarios.find(e => e.id === "mkt-baja").ficha = "";   // la empresa lo vació a propósito: queda vacío
    assert.equal((await pedir(app.base, "/api/empresa", { method: "PUT", json: cfg })).status, 200);
    const page = await (await browser.newContext({ locale: "es-AR" })).newPage();
    await ingresarEn(page, app.base, "estudiante1");
    await page.locator(".card", { hasText: "Llamada de cobranza" }).click();
    const brief = await page.locator(".brief").innerText();
    assert.match(brief, /lo que tenés a mano/i);
    assert.match(brief, /38\.000/);
    assert.doesNotMatch(brief, /Voz natural/, "sin la frase de la voz natural");
    await page.locator("button", { hasText: "Volver" }).click();
    await page.locator(".card", { hasText: "Quiero dar de baja" }).click();
    assert.doesNotMatch(await page.locator(".brief").innerText(), /lo que tenés a mano/i);
  });
});

describe("filtros de los informes", { skip: saltear }, () => {
  let app, browser, lucas, ana;
  const DIA = 24 * 60 * 60 * 1000;
  const haceDias = n => new Date(Date.now() - n * DIA).toISOString();
  const informe = extra => ({
    duracionSeg: 200, empresa: "Nodo Software", puntaje: 70, evaluacion: { resumen: "r", criterios: [] }, criteriosDef: [], transcripcion: [],
    escenario: { titulo: "Llamada de cobranza", resumen: "r", cliente: "Diego Sosa", objetivo: "o" }, ...extra
  });
  const crear = async (cookie, extra) => assert.equal((await pedir(app.base, "/api/informes", { method: "POST", cookie, json: informe(extra) })).status, 200);
  const nuevaPagina = async () => (await browser.newContext({ locale: "es-AR" })).newPage();
  const vista = (page, t) => page.waitForFunction(t => document.getElementById("viewLabel").textContent === t, t, { timeout: 15000 });
  const filas = (page, n) => page.waitForFunction(n => document.querySelectorAll(".informes-lista .list button").length === n, n, { timeout: 10000 });
  // El día de hoy menos n, como lo escribe el campo de fecha y en la hora del navegador.
  const dia = (page, n) => page.evaluate(n => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, n);

  before(async () => {
    app = await startApp({ provider: "gemini" });
    browser = await chromium.launch();
    lucas = await app.ingresar("estudiante1"); ana = await app.ingresar("estudiante2");
    // Lucas: una cobranza de hoy y una baja de hace 10 días.
    await crear(lucas, { fecha: haceDias(0) });
    await crear(lucas, { fecha: haceDias(10), escenario: { titulo: "Quiero dar de baja", resumen: "r", cliente: "Marta", objetivo: "o" } });
  });
  after(async () => { if (browser) await browser.close(); if (app) await app.stop(); });

  test("quien todavía no hizo ninguna simulación ve el mensaje, sin la barra de filtros", async () => {
    const page = await nuevaPagina();
    await ingresarEn(page, app.base, "estudiante2");
    await page.locator('.nav button:has-text("Mis informes")').click();
    await vista(page, "Mis informes");
    await page.getByText("Todavía no hiciste ninguna simulación.").waitFor();
    assert.ok(await page.locator(".filtros").isHidden());
  });

  test("el candidato filtra sus informes por simulación y no tiene filtro de candidato", async () => {
    const page = await nuevaPagina();
    await ingresarEn(page, app.base, "estudiante1");
    await page.locator('.nav button:has-text("Mis informes")').click();
    await vista(page, "Mis informes");
    await filas(page, 2);
    assert.equal(await page.locator("#fCandidato").count(), 0, "el candidato no elige candidato");
    await page.waitForFunction(() => document.querySelectorAll("#fEscenario option").length === 3);
    assert.deepEqual(await page.locator("#fEscenario option").allTextContents(), ["Todas", "Llamada de cobranza", "Quiero dar de baja"]);

    await page.locator("#fEscenario").selectOption("Quiero dar de baja");
    await filas(page, 1);
    assert.match(await page.locator(".informes-lista .list").innerText(), /Quiero dar de baja/);

    // El filtro es de esta lista: el inicio sigue mostrando todas sus simulaciones.
    await page.locator('.nav button:has-text("Simulaciones")').click();
    await vista(page, "Simulaciones por voz");
    assert.equal(await page.locator(".list button").count(), 2);
  });

  test("la empresa filtra por candidato, simulación y fechas, y los filtros siguen puestos al volver de un informe", async () => {
    // Ana: una cobranza de hace 3 días. Y un informe de otra empresa, que acá no se tiene que ver.
    await crear(ana, { fecha: haceDias(3) });
    await crear(ana, { fecha: haceDias(1), empresa: "Otra Empresa SA", escenario: { titulo: "Escenario de otra empresa", resumen: "r", cliente: "x", objetivo: "o" } });

    const page = await nuevaPagina();
    await ingresarEn(page, app.base, "empresa1");
    await vista(page, "Informes de candidatos");
    await filas(page, 3);
    await page.waitForFunction(() => document.querySelectorAll("#fCandidatos option").length === 2);
    assert.deepEqual(await page.locator("#fCandidatos option").evaluateAll(os => os.map(o => o.value)), ["Ana Paz", "Lucas Ferreyra"]);
    assert.deepEqual(await page.locator("#fEscenario option").allTextContents(), ["Todas", "Llamada de cobranza", "Quiero dar de baja"], "sin las simulaciones de otra empresa");
    assert.ok(await page.locator("#fLimpiar").isDisabled(), "sin filtros no hay nada que limpiar");

    // Candidato: alcanza con una parte del nombre, sin importar las mayúsculas.
    await page.locator("#fCandidato").fill("PAZ");
    await filas(page, 1);
    assert.match(await page.locator(".informes-lista .list").innerText(), /Ana Paz/);
    await page.locator("#fCandidato").fill("nadie se llama así");
    await page.getByText("No hay informes con estos filtros.").waitFor();
    await page.locator("#fLimpiar").click();
    await filas(page, 3);
    assert.equal(await page.locator("#fCandidato").inputValue(), "");

    // Simulación, y el filtro sigue puesto al volver del informe.
    await page.locator("#fEscenario").selectOption("Quiero dar de baja");
    await filas(page, 1);
    await page.locator(".informes-lista .list button").first().click();
    await vista(page, "Informe");
    await page.locator("button", { hasText: "Volver" }).click();
    await vista(page, "Informes de candidatos");
    await filas(page, 1);
    assert.equal(await page.locator("#fEscenario").inputValue(), "Quiero dar de baja");
    await page.locator("#fLimpiar").click();
    await filas(page, 3);

    // Fechas: "desde hace 5 días" deja afuera el de hace 10; "hasta hace 1 día" deja afuera el de hoy.
    await page.locator("#fDesde").fill(await dia(page, 5));
    await filas(page, 2);
    await page.locator("#fHasta").fill(await dia(page, 1));
    await filas(page, 1);
    assert.match(await page.locator(".informes-lista .list").innerText(), /Ana Paz/);
    // "Hasta hoy" incluye el informe hecho hoy, a cualquier hora.
    await page.locator("#fHasta").fill(await dia(page, 0));
    await filas(page, 2);
    await page.locator("#fDesde").fill(await dia(page, 0));
    await filas(page, 1);
    assert.match(await page.locator(".informes-lista .list").innerText(), /Lucas Ferreyra/);

    // El rango al revés avisa y no busca.
    await page.locator("#fHasta").fill(await dia(page, 4));
    await page.getByText("“Desde” no puede ser posterior a “Hasta”.").waitFor();
    await filas(page, 1);
  });
});
