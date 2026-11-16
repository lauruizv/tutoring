/* Pruebas del almacén de audios de las simulaciones y de la regla de vencimiento.
   No levantan el servidor: el almacén trabaja sobre una carpeta temporal. */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { crearAlmacenDeAudios, formatoDe } = require("../backend/src/modules/simulaciones/repositories/audios-archivos.repository.js");
const { audioVencido } = require("../backend/src/modules/simulaciones/informes/audio-reglas.js");

// Comienzos de archivo de cada formato, con relleno.
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from("ftypisom"), Buffer.alloc(100, 7)]);
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(100, 7)]);
const ID = "3f0c9a52-7b1e-4c6d-9a4e-2d5b8c1f0a77";

describe("formato del audio", () => {
  test("reconoce WebM, MP4 y Ogg por los primeros bytes", () => {
    assert.equal(formatoDe(WEBM).mime, "audio/webm");
    assert.equal(formatoDe(MP4).mime, "audio/mp4");
    assert.equal(formatoDe(OGG).mime, "audio/ogg");
  });

  test("lo que no es un audio conocido no pasa, se llame como se llame", () => {
    const noSonAudio = [Buffer.from("<html><script>alert(1)</script></html>"), Buffer.from('{"id":"x"}'), Buffer.from("MZ\x90\x00 programa"), Buffer.alloc(0),
      Buffer.from([0x1a, 0x45, 0xdf]), Buffer.from("%PDF-1.7"), "\x1aE\xdf\xa3 texto, no bytes", null, undefined];
    for (const contenido of noSonAudio) assert.equal(formatoDe(contenido), null, String(contenido).slice(0, 20));
  });
});

describe("vencimiento", () => {
  const DIA = 24 * 60 * 60 * 1000;
  const ahora = Date.parse("2026-11-11T12:00:00.000Z");
  const audio = hace => ({ mime: "audio/webm", bytes: 1000, subido: new Date(ahora - hace).toISOString() });

  test("un audio vence cuando se cumple el plazo, ni antes", () => {
    assert.equal(audioVencido(audio(0), ahora, 90), false);
    assert.equal(audioVencido(audio(89 * DIA), ahora, 90), false);
    assert.equal(audioVencido(audio(90 * DIA - 1000), ahora, 90), false, "un segundo antes de los 90 días");
    assert.equal(audioVencido(audio(90 * DIA), ahora, 90), true, "justo a los 90 días");
    assert.equal(audioVencido(audio(400 * DIA), ahora, 90), true);
  });

  test("un informe sin audio guardado no tiene nada que vencer", () => {
    for (const a of [undefined, null, {}, { borrado: "2026-01-01T00:00:00.000Z", motivo: "vencimiento" }, "audio"]) assert.equal(audioVencido(a, ahora, 90), false, JSON.stringify(a));
  });

  test("un audio sin fecha legible se da por vencido: ante la duda no se conserva", () => {
    assert.equal(audioVencido({ bytes: 1000 }, ahora, 90), true);
    assert.equal(audioVencido({ bytes: 1000, subido: "ayer" }, ahora, 90), true);
  });
});

describe("almacén de audios", () => {
  let dir, almacen;
  before(() => { dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "audios-")), "audios"); almacen = crearAlmacenDeAudios(dir); });
  after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));

  test("sin nada guardado: abrir da null, borrar da false y no hay ids (aunque la carpeta no exista)", async () => {
    assert.equal(await almacen.abrir(ID), null);
    assert.equal(await almacen.borrar(ID), false);
    assert.deepEqual(await almacen.ids(), []);
  });

  test("guarda el audio con su formato y lo devuelve igual", async () => {
    assert.deepEqual(await almacen.guardar(ID, WEBM), { mime: "audio/webm", bytes: WEBM.length });
    const abierto = await almacen.abrir(ID);
    assert.equal(abierto.mime, "audio/webm");
    assert.equal(abierto.bytes, WEBM.length);
    assert.ok(abierto.contenido.equals(WEBM));
    assert.deepEqual(fs.readdirSync(dir), [ID + ".webm"], "queda un solo archivo, sin temporales");
    assert.deepEqual(await almacen.ids(), [ID]);
  });

  test("cada formato se guarda con su extensión", async () => {
    const otro = "aaaaaaaa-0000-4000-8000-000000000001";
    assert.equal((await almacen.guardar(otro, MP4)).mime, "audio/mp4");
    assert.ok(fs.existsSync(path.join(dir, otro + ".m4a")));
    assert.equal((await almacen.abrir(otro)).mime, "audio/mp4");
    assert.equal(await almacen.borrar(otro), true);
  });

  test("lo que no es audio no se guarda", async () => {
    const otro = "bbbbbbbb-0000-4000-8000-000000000002";
    assert.equal(await almacen.guardar(otro, Buffer.from("<html>hola</html>")), null);
    assert.equal(await almacen.abrir(otro), null);
    assert.deepEqual(fs.readdirSync(dir), [ID + ".webm"]);
  });

  test("un id raro no llega al disco: no se puede salir de la carpeta", async () => {
    for (const id of ["../../etc/passwd", "..\\..\\secreto", "a/b", "", "corto", null, undefined, 42, ID + "/../x", ID + ".webm"]) {
      await assert.rejects(almacen.guardar(id, WEBM), /inválido/, String(id));
      await assert.rejects(almacen.abrir(id), /inválido/, String(id));
      await assert.rejects(almacen.borrar(id), /inválido/, String(id));
    }
    assert.deepEqual(fs.readdirSync(dir), [ID + ".webm"]);
  });

  test("ids ignora lo que no es un audio de un informe", async () => {
    fs.writeFileSync(path.join(dir, "notas.txt"), "x");
    fs.writeFileSync(path.join(dir, ID + ".webm.123.tmp"), "a medio escribir");
    assert.deepEqual(await almacen.ids(), [ID]);
    fs.unlinkSync(path.join(dir, "notas.txt")); fs.unlinkSync(path.join(dir, ID + ".webm.123.tmp"));
  });

  test("borrar saca el archivo y avisa que había", async () => {
    assert.equal(await almacen.borrar(ID), true);
    assert.equal(await almacen.abrir(ID), null);
    assert.equal(await almacen.borrar(ID), false);
    assert.deepEqual(await almacen.ids(), []);
  });
});
