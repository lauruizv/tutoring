/* Pruebas del audio de las simulaciones en el servidor: quién lo puede subir y escuchar,
   que sin la aceptación no se guarde nada, el borrado y el vencimiento a los 90 días. */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startApp, pedir, pedirBytes } from "./helpers.mjs";

const DIA = 24 * 60 * 60 * 1000;
// Un "audio" WebM: lo que mira el servidor son los primeros bytes.
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(3000, 9)]);
const ACEPTA = { aceptado: true, version: "2026-11-11", texto: "Acepto que se grabe el audio de esta simulación.", fecha: "2026-11-11T12:00:00.000Z" };
const INFORME = { fecha: "2026-11-11T12:00:00.000Z", evaluacion: { criterios: [] }, puntaje: 70, escenario: { titulo: "Llamada de cobranza" }, transcripcion: [{ role: "user", text: "Hola", t0: 1, t1: 2 }] };

describe("audio de las simulaciones", () => {
  let app, lucas, ana, junior;
  const crear = async (cookie, extra) => {
    const r = await pedir(app.base, "/api/informes", { method: "POST", cookie, json: { ...INFORME, ...extra } });
    assert.equal(r.status, 200);
    return r.cuerpo.id;
  };
  const subir = (id, cookie, bytes = WEBM, consulta = "?duracion=245.4") => pedirBytes(app.base, `/api/informes/${id}/audio${consulta}`, { method: "PUT", cookie, bytes, tipo: "audio/webm" });
  const escuchar = (id, cookie) => pedirBytes(app.base, `/api/informes/${id}/audio`, { cookie });
  const informe = async id => (await pedir(app.base, "/api/informes/" + id)).cuerpo;
  const archivos = () => { try { return fs.readdirSync(path.join(app.dataDir, "audios")); } catch (_) { return []; } };

  before(async () => {
    app = await startApp({ provider: "gemini" });
    lucas = await app.ingresar("estudiante1"); ana = await app.ingresar("estudiante2"); junior = await app.ingresar("junior1");
  });
  after(async () => { await app.stop(); });

  test("/api/config dice cuántos días se guarda la grabación", async () => {
    assert.deepEqual((await pedir(app.base, "/api/config", { cookie: lucas })).cuerpo.audio, { dias: 90 });
  });

  test("al guardar el informe, la aceptación queda con la fecha del servidor y el navegador no puede inventar el audio", async () => {
    const antes = Date.now();
    const id = await crear(lucas, { consentimientoAudio: { ...ACEPTA, otraCosa: "no se guarda", texto: "x".repeat(5000) }, audio: { mime: "audio/webm", bytes: 999, subido: "2026-01-01T00:00:00.000Z" } });
    const r = await informe(id);
    assert.deepEqual(Object.keys(r.consentimientoAudio).sort(), ["aceptado", "fecha", "registrado", "texto", "version"]);
    assert.equal(r.consentimientoAudio.aceptado, true);
    assert.equal(r.consentimientoAudio.version, "2026-11-11");
    assert.equal(r.consentimientoAudio.fecha, "2026-11-11T12:00:00.000Z");
    assert.equal(r.consentimientoAudio.texto.length, 1200, "el texto se recorta");
    assert.ok(Date.parse(r.consentimientoAudio.registrado) >= antes - 1000, "la fecha de registro la pone el servidor");
    assert.equal(r.audio, undefined, "el dato del audio solo lo anota el servidor al recibir el archivo");
    assert.equal((await escuchar(id, lucas)).status, 404);

    // Solo vale un "sí" explícito; cualquier otra cosa queda como que no aceptó.
    for (const aceptado of [false, "true", 1, undefined]) {
      const otro = await informe(await crear(lucas, { consentimientoAudio: { ...ACEPTA, aceptado } }));
      assert.equal(otro.consentimientoAudio.aceptado, false, String(aceptado));
    }
    assert.equal((await informe(await crear(lucas, { consentimientoAudio: "sí" }))).consentimientoAudio, undefined);
  });

  test("quien aceptó sube el audio una vez; lo escuchan él y la empresa, y nadie más", async () => {
    const id = await crear(lucas, { consentimientoAudio: ACEPTA });
    const antes = Date.now();
    const subida = await subir(id, lucas);
    assert.equal(subida.status, 200);
    assert.equal(subida.cuerpo.audio.mime, "audio/webm");
    assert.equal(subida.cuerpo.audio.bytes, WEBM.length);
    assert.equal(subida.cuerpo.audio.duracionSeg, 245);
    assert.ok(Date.parse(subida.cuerpo.audio.subido) >= antes - 1000);
    assert.deepEqual((await informe(id)).audio, subida.cuerpo.audio, "queda anotado en el informe");
    assert.deepEqual(archivos(), [id + ".webm"]);

    for (const [quien, cookie] of [["el candidato", lucas], ["la empresa", undefined]]) {
      const r = await escuchar(id, cookie);
      assert.equal(r.status, 200, quien);
      assert.equal(r.headers.get("content-type"), "audio/webm");
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      assert.ok(r.bytes.equals(WEBM), quien + " recibe el mismo archivo");
    }
    for (const [quien, cookie] of [["otro candidato", ana], ["un junior", junior]]) {
      const r = await escuchar(id, cookie);
      assert.equal(r.status, 403, quien);
      assert.equal(r.bytes.includes(WEBM.subarray(0, 4)), false, quien + " no recibe ni un byte del audio");
    }
    assert.equal((await escuchar(id, null)).status, 401, "sin sesión");

    const otraVez = await subir(id, lucas);
    assert.equal(otraVez.status, 409, "el audio no se reemplaza");
    assert.ok((await escuchar(id, lucas)).bytes.equals(WEBM));
  });

  test("sin la aceptación en el informe, el audio no se guarda", async () => {
    for (const consentimientoAudio of [undefined, { ...ACEPTA, aceptado: false }]) {
      const id = await crear(lucas, consentimientoAudio ? { consentimientoAudio } : {});
      const r = await subir(id, lucas);
      assert.equal(r.status, 403);
      assert.match(r.cuerpo.error.message, /no consta que se aceptó/);
      assert.equal((await informe(id)).audio, undefined);
      assert.equal(archivos().includes(id + ".webm"), false);
    }
  });

  test("solo sube el audio quien hizo la simulación: ni otro candidato, ni la empresa, ni alguien sin sesión", async () => {
    const id = await crear(lucas, { consentimientoAudio: ACEPTA });
    assert.equal((await subir(id, ana)).status, 403);
    assert.equal((await subir(id, undefined)).status, 403, "la empresa");
    assert.equal((await subir(id, null)).status, 401);
    assert.equal(archivos().includes(id + ".webm"), false);
    assert.equal((await informe(id)).audio, undefined);
  });

  test("lo que no es un audio, lo que pesa demasiado y los pedidos mal hechos se rechazan sin guardar nada", async () => {
    const id = await crear(lucas, { consentimientoAudio: ACEPTA });
    for (const [bytes, por] of [[Buffer.from("<html><script>alert(1)</script></html>"), "html"], [Buffer.from("MZ programa"), "ejecutable"], [Buffer.alloc(0), "vacío"]]) {
      const r = await subir(id, lucas, bytes);
      assert.equal(r.status, 415, por);
    }
    const enorme = await subir(id, lucas, Buffer.concat([WEBM.subarray(0, 4), Buffer.alloc(10_000_001)]));
    assert.equal(enorme.status, 413);
    assert.match(enorme.cuerpo.error.message, /10 MB/);
    assert.equal((await informe(id)).audio, undefined);
    assert.equal(archivos().includes(id + ".webm"), false);

    assert.equal((await subir("no-existe-ese-informe", lucas)).status, 404);
    assert.equal((await subir("..%2f..%2fx", lucas)).status, 400);
    assert.equal((await pedirBytes(app.base, `/api/informes/${id}/audio`, { method: "DELETE", cookie: lucas })).status, 405);

    // Después de los rechazos, el audio bueno entra. Una duración rara no se guarda.
    const ok = await subir(id, lucas, WEBM, "?duracion=-5");
    assert.equal(ok.status, 200);
    assert.equal(ok.cuerpo.audio.duracionSeg, null);
  });

  test("al borrar el informe se borra su audio", async () => {
    const id = await crear(lucas, { consentimientoAudio: ACEPTA });
    assert.equal((await subir(id, lucas)).status, 200);
    assert.ok(archivos().includes(id + ".webm"));
    assert.equal((await pedir(app.base, "/api/informes/" + id, { method: "DELETE" })).status, 200);
    assert.equal(archivos().includes(id + ".webm"), false);
    assert.equal((await escuchar(id, lucas)).status, 404);
  });

  test("un audio vencido no se entrega: se borra en el momento y el informe lo dice", async () => {
    const id = await crear(lucas, { consentimientoAudio: ACEPTA });
    assert.equal((await subir(id, lucas)).status, 200);
    // Se le cambia la fecha de subida al informe, como si hubieran pasado 91 días.
    const archivo = path.join(app.dataDir, "informes", id + ".json");
    const r = JSON.parse(fs.readFileSync(archivo, "utf8"));
    r.audio.subido = new Date(Date.now() - 91 * DIA).toISOString();
    fs.writeFileSync(archivo, JSON.stringify(r));

    const pedido = await escuchar(id, lucas);
    assert.equal(pedido.status, 404);
    assert.match(pedido.cuerpo.error.message, /ya se borró: se guarda 90 días/);
    assert.equal(archivos().includes(id + ".webm"), false, "el archivo se borró");
    const despues = await informe(id);
    assert.equal(despues.audio.motivo, "vencimiento");
    assert.ok(despues.audio.borrado);
    assert.equal(despues.audio.bytes, undefined);
    assert.equal(despues.puntaje, 70, "el informe sigue estando");
    assert.equal((await subir(id, lucas)).status, 409, "un audio vencido no se vuelve a subir");
  });

  test("a los 89 días todavía se entrega", async () => {
    const id = await crear(lucas, { consentimientoAudio: ACEPTA });
    assert.equal((await subir(id, lucas)).status, 200);
    const archivo = path.join(app.dataDir, "informes", id + ".json");
    const r = JSON.parse(fs.readFileSync(archivo, "utf8"));
    r.audio.subido = new Date(Date.now() - 89 * DIA).toISOString();
    fs.writeFileSync(archivo, JSON.stringify(r));
    assert.equal((await escuchar(id, lucas)).status, 200);
  });
});

describe("limpieza de audios al arrancar el servidor", () => {
  let app;
  const VIEJO = "aaaaaaaa-0000-4000-8000-000000000001", NUEVO = "bbbbbbbb-0000-4000-8000-000000000002", HUERFANO = "cccccccc-0000-4000-8000-000000000003";
  const informe = (id, haceDias) => ({ id, usuarioId: "u1", candidato: "Lucas Ferreyra", ...INFORME, consentimientoAudio: ACEPTA,
    audio: { mime: "audio/webm", bytes: WEBM.length, duracionSeg: 200, subido: new Date(Date.now() - haceDias * DIA).toISOString() } });

  before(async () => {
    app = await startApp({
      provider: "gemini",
      sembrar: dataDir => {
        fs.mkdirSync(path.join(dataDir, "audios"), { recursive: true });
        fs.writeFileSync(path.join(dataDir, "informes", VIEJO + ".json"), JSON.stringify(informe(VIEJO, 120)));
        fs.writeFileSync(path.join(dataDir, "informes", NUEVO + ".json"), JSON.stringify(informe(NUEVO, 10)));
        for (const id of [VIEJO, NUEVO, HUERFANO]) fs.writeFileSync(path.join(dataDir, "audios", id + ".webm"), WEBM);
      }
    });
  });
  after(async () => { await app.stop(); });

  test("borra los vencidos y los que quedaron sin informe, y deja los que están en plazo", async () => {
    const audios = () => fs.readdirSync(path.join(app.dataDir, "audios")).sort();
    // La limpieza arranca junto con el servidor: se le da un momento para terminar.
    for (let i = 0; i < 50 && audios().length > 1; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(audios(), [NUEVO + ".webm"]);

    const viejo = (await pedir(app.base, "/api/informes/" + VIEJO)).cuerpo;
    assert.equal(viejo.audio.motivo, "vencimiento");
    assert.equal(viejo.audio.bytes, undefined);
    assert.equal(viejo.candidato, "Lucas Ferreyra", "el informe no se toca");
    assert.equal((await pedir(app.base, "/api/informes/" + NUEVO)).cuerpo.audio.bytes, WEBM.length);
    assert.equal((await pedirBytes(app.base, `/api/informes/${NUEVO}/audio`)).status, 200);
    assert.match(app.log(), /se borraron 2/);
  });
});
