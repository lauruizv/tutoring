/* Pruebas de la lista de informes: el filtro (lógica pura) y el repositorio de archivos.
   No levantan el servidor: el repositorio trabaja sobre una carpeta temporal. */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizarFiltro, cumple } = require("../backend/src/modules/simulaciones/informes/filtro.js");
const { crearRepositorioArchivos } = require("../backend/src/modules/simulaciones/repositories/informes-archivos.repository.js");

const TODOS = { todos: true };
const filtro = obj => normalizarFiltro(new URLSearchParams(obj));

describe("normalizarFiltro", () => {
  test("sin parámetros no filtra nada", () => {
    assert.deepEqual(filtro({}), { desde: null, hasta: null, candidato: "", escenario: "", empresa: "" });
  });

  test("las fechas quedan como instantes ISO y los textos, sin espacios de más", () => {
    const f = filtro({ desde: "2026-11-01T03:00:00.000Z", hasta: "2026-11-11T03:00:00.000Z", candidato: "  Pérez ", escenario: " Llamada de cobranza ", empresa: "MKT" });
    assert.deepEqual(f, { desde: "2026-11-01T03:00:00.000Z", hasta: "2026-11-11T03:00:00.000Z", candidato: "Pérez", escenario: "Llamada de cobranza", empresa: "MKT" });
  });

  test("acepta un objeto común además de URLSearchParams", () => {
    assert.equal(normalizarFiltro({ candidato: "Ana" }).candidato, "Ana");
    assert.equal(normalizarFiltro(null).candidato, "");
  });

  test("una fecha que no se entiende es un error con mensaje para la persona", () => {
    for (const campo of ["desde", "hasta"]) {
      assert.throws(() => filtro({ [campo]: "ayer" }), e => e.code === "filtro_invalido" && new RegExp(campo).test(e.message));
    }
  });

  test("el rango al revés es un error", () => {
    assert.throws(() => filtro({ desde: "2026-11-10T00:00:00.000Z", hasta: "2026-11-01T00:00:00.000Z" }), e => e.code === "filtro_invalido");
  });

  test("los textos larguísimos se recortan", () => {
    assert.equal(filtro({ candidato: "a".repeat(5000) }).candidato.length, 120);
  });
});

describe("cumple", () => {
  const r = { id: "x", candidato: "Lucía Pérez", escenario: "Llamada de cobranza", empresa: "MKT Contact Center", fecha: "2026-11-10T15:00:00.000Z", puntaje: 80 };

  test("sin filtros pasa todo", () => assert.ok(cumple(r, filtro({}))));

  test("desde incluye el instante exacto y hasta lo excluye", () => {
    assert.ok(cumple(r, filtro({ desde: "2026-11-10T15:00:00.000Z" })));
    assert.ok(!cumple(r, filtro({ desde: "2026-11-10T15:00:00.001Z" })));
    assert.ok(cumple(r, filtro({ hasta: "2026-11-10T15:00:00.001Z" })));
    assert.ok(!cumple(r, filtro({ hasta: "2026-11-10T15:00:00.000Z" })));
  });

  test("con filtro de fechas, un informe sin fecha legible queda afuera", () => {
    assert.ok(!cumple({ ...r, fecha: "sin fecha" }, filtro({ desde: "2026-01-01T00:00:00.000Z" })));
    assert.ok(cumple({ ...r, fecha: "sin fecha" }, filtro({})));
  });

  test("candidato: alcanza con una parte del nombre, sin importar tildes ni mayúsculas", () => {
    for (const texto of ["perez", "PÉREZ", "lucia p", "cía"]) assert.ok(cumple(r, filtro({ candidato: texto })), texto);
    assert.ok(!cumple(r, filtro({ candidato: "gomez" })));
  });

  test("simulación: tiene que ser el título completo", () => {
    assert.ok(cumple(r, filtro({ escenario: "llamada de cobranza" })));
    assert.ok(!cumple(r, filtro({ escenario: "cobranza" })));
  });

  test("empresa: pasan los de esa empresa y los informes viejos sin empresa", () => {
    assert.ok(cumple(r, filtro({ empresa: "MKT Contact Center" })));
    assert.ok(!cumple(r, filtro({ empresa: "Nodo Software" })));
    assert.ok(cumple({ ...r, empresa: undefined }, filtro({ empresa: "Nodo Software" })));
  });

  test("los filtros se suman", () => {
    assert.ok(cumple(r, filtro({ candidato: "lucia", escenario: "Llamada de cobranza", desde: "2026-11-10T00:00:00.000Z", hasta: "2026-11-11T00:00:00.000Z" })));
    assert.ok(!cumple(r, filtro({ candidato: "lucia", escenario: "Pedido de baja" })));
  });
});

describe("repositorio de archivos", () => {
  let dir, repo;
  const informe = (id, extra) => ({
    id, usuarioId: "u-lucia", candidato: "Lucía Pérez", empresa: "MKT Contact Center", fecha: "2026-11-10T15:00:00.000Z", duracionSeg: 240, puntaje: 80,
    escenario: { titulo: "Llamada de cobranza", resumen: "r" }, evaluacion: { resumen: "no va en la lista" }, transcripcion: [{ role: "user", text: "Hola" }], ...extra
  });

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "informes-"));
    const guardar = r => fs.writeFileSync(path.join(dir, r.id + ".json"), JSON.stringify(r));
    guardar(informe("a-lucia-cobranza"));
    guardar(informe("b-lucia-baja", { fecha: "2026-11-05T12:00:00.000Z", escenario: { titulo: "Quiero dar de baja" }, puntaje: 55 }));
    guardar(informe("c-tomas-cobranza", { usuarioId: "u-tomas", candidato: "Tomás Gómez", fecha: "2026-11-08T12:00:00.000Z" }));
    guardar(informe("d-otra-empresa", { usuarioId: "u-ana", candidato: "Ana Ruiz", empresa: "Nodo Software", fecha: "2026-11-09T12:00:00.000Z", escenario: { titulo: "Viernes a la noche" } }));
    guardar(informe("e-viejo-sin-usuario", { usuarioId: undefined, candidato: "Viejo", duracionSeg: undefined, fecha: "2026-01-01T00:00:00.000Z" }));
    fs.writeFileSync(path.join(dir, "roto.json"), "{ esto no es JSON");
    fs.writeFileSync(path.join(dir, "lista.json"), "[1, 2]");
    fs.writeFileSync(path.join(dir, "notas.txt"), "no es un informe");
    repo = crearRepositorioArchivos(dir);
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("devuelve resúmenes (nunca el informe entero), del más nuevo al más viejo, y saltea lo que no es un informe", async () => {
    const lista = await repo.listarResumenes(filtro({}), TODOS);
    assert.deepEqual(lista.map(r => r.id), ["a-lucia-cobranza", "d-otra-empresa", "c-tomas-cobranza", "b-lucia-baja", "e-viejo-sin-usuario"]);
    assert.deepEqual(lista[0], { id: "a-lucia-cobranza", candidato: "Lucía Pérez", escenario: "Llamada de cobranza", empresa: "MKT Contact Center", fecha: "2026-11-10T15:00:00.000Z", puntaje: 80, duracionSeg: 240 });
    assert.equal(lista.at(-1).duracionSeg, null, "sin duración guardada queda en null");
  });

  test("aplica el filtro", async () => {
    const ids = async obj => (await repo.listarResumenes(filtro(obj), TODOS)).map(r => r.id);
    assert.deepEqual(await ids({ candidato: "gomez" }), ["c-tomas-cobranza"]);
    assert.deepEqual(await ids({ escenario: "Quiero dar de baja" }), ["b-lucia-baja"]);
    assert.deepEqual(await ids({ desde: "2026-11-06T00:00:00.000Z", hasta: "2026-11-09T00:00:00.000Z" }), ["c-tomas-cobranza"]);
    assert.deepEqual(await ids({ empresa: "Nodo Software" }), ["d-otra-empresa"]);
    assert.deepEqual(await ids({ candidato: "nadie" }), []);
  });

  test("el alcance limita a los informes de esa persona, con o sin filtro", async () => {
    const lucia = { usuarioId: "u-lucia" };
    assert.deepEqual((await repo.listarResumenes(filtro({}), lucia)).map(r => r.id), ["a-lucia-cobranza", "b-lucia-baja"]);
    assert.deepEqual(await repo.listarResumenes(filtro({ candidato: "Tomás" }), lucia), [], "filtrar por otro nombre no muestra informes ajenos");
  });

  test("el alcance por empresa trae solo los informes guardados con ese empresaId", async () => {
    const otra = fs.mkdtempSync(path.join(os.tmpdir(), "informes-emp-"));
    try {
      const guardar = r => fs.writeFileSync(path.join(otra, r.id + ".json"), JSON.stringify(r));
      guardar(informe("a-de-emp1", { empresaId: "emp-1", fecha: "2026-11-10T10:00:00.000Z" }));
      guardar(informe("b-de-emp1", { empresaId: "emp-1", fecha: "2026-11-12T10:00:00.000Z" }));
      guardar(informe("c-de-emp2", { empresaId: "emp-2" }));
      guardar(informe("d-sin-empresa-id"));
      const r = crearRepositorioArchivos(otra);
      assert.deepEqual((await r.listarResumenes({}, { empresaId: "emp-1" })).map(x => x.id), ["b-de-emp1", "a-de-emp1"]);
      assert.deepEqual(await r.listarResumenes({}, { empresaId: "emp-3" }), []);
      assert.deepEqual((await r.listarResumenes({}, { usuarioId: "u-lucia", empresaId: "emp-2" })).length, 4, "con usuarioId manda la persona");
    } finally { fs.rmSync(otra, { recursive: true, force: true }); }
  });

  test("un alcance vacío o mal armado no ve nada: nunca se abre por descuido", async () => {
    for (const alcance of [{}, null, undefined, { usuarioId: "" }, { usuarioId: undefined }, { todos: "sí" }, { empresaId: "" }, { empresaId: undefined }]) {
      assert.deepEqual(await repo.listarResumenes(filtro({}), alcance), [], JSON.stringify(alcance));
      assert.deepEqual(await repo.listarOpciones(alcance, filtro({})), { candidatos: [], escenarios: [] }, JSON.stringify(alcance));
    }
  });

  test("las opciones salen de lo que esa persona puede ver, en orden alfabético y sin repetir", async () => {
    assert.deepEqual(await repo.listarOpciones(TODOS, filtro({ empresa: "MKT Contact Center" })), {
      candidatos: ["Lucía Pérez", "Tomás Gómez", "Viejo"],
      escenarios: ["Llamada de cobranza", "Quiero dar de baja"]
    });
    assert.deepEqual(await repo.listarOpciones({ usuarioId: "u-tomas" }, filtro({})), { candidatos: ["Tomás Gómez"], escenarios: ["Llamada de cobranza"] });
  });

  test("las opciones no se achican con los otros filtros: solo las limita la empresa", async () => {
    const op = await repo.listarOpciones(TODOS, filtro({ empresa: "MKT Contact Center", candidato: "Tomás", escenario: "Quiero dar de baja" }));
    assert.equal(op.candidatos.length, 3);
    assert.equal(op.escenarios.length, 2);
  });

  test("si la carpeta no existe, la lista está vacía", async () => {
    const vacio = crearRepositorioArchivos(path.join(dir, "no-existe"));
    assert.deepEqual(await vacio.listarResumenes(filtro({}), TODOS), []);
    assert.deepEqual(await vacio.listarOpciones(TODOS, filtro({})), { candidatos: [], escenarios: [] });
  });

  test("lee carpetas con más archivos que un lote", async () => {
    const muchos = fs.mkdtempSync(path.join(os.tmpdir(), "informes-muchos-"));
    try {
      for (let i = 0; i < 70; i++) fs.writeFileSync(path.join(muchos, `inf-${i}.json`), JSON.stringify(informe(`inf-${i}`)));
      assert.equal((await crearRepositorioArchivos(muchos).listarResumenes(filtro({}), TODOS)).length, 70);
    } finally { fs.rmSync(muchos, { recursive: true, force: true }); }
  });
});
