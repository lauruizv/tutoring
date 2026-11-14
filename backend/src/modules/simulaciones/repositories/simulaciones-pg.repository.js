// Simulaciones en Postgres: una fila por simulación hecha, con el precio que se cobró en ese momento.
// Solo acceso a datos; qué se guarda y a qué precio lo decide simulaciones.service.js.
const { query } = require("../../../shared/db");

// escenario_id queda en NULL (todavía no hay escenarios en la base) y realizada_en la pone la base.
async function insertar({ empresaId, usuarioId, escenarioTitulo, escenarioResumen, escenarioCliente, escenarioObjetivo, duracionSeg, precioUsd }) {
  const { rows } = await query(
    `INSERT INTO simulaciones
       (empresa_id, usuario_id, escenario_titulo, escenario_resumen, escenario_cliente, escenario_objetivo, duracion_seg, precio_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [empresaId, usuarioId, escenarioTitulo, escenarioResumen, escenarioCliente, escenarioObjetivo, duracionSeg, precioUsd]);
  return rows[0].id;
}

async function borrar(id) {
  await query("DELETE FROM simulaciones WHERE id = $1", [id]);
}

// Totales de una empresa: de siempre y de los últimos `dias` días (ventana corrida hasta ahora).
// El gasto es la suma de los precios guardados en cada fila, no cantidad por el precio de hoy.
async function resumen(empresaId, dias) {
  const { rows } = await query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE realizada_en >= now() - make_interval(days => $2::int)) AS en_periodo,
            coalesce(sum(precio_usd), 0) AS gasto_total,
            coalesce(sum(precio_usd) FILTER (WHERE realizada_en >= now() - make_interval(days => $2::int)), 0) AS gasto_en_periodo
       FROM simulaciones
      WHERE empresa_id = $1`,
    [empresaId, dias]);
  const r = rows[0];
  // Postgres devuelve count (bigint) y numeric como texto.
  return {
    total: Number(r.total),
    enPeriodo: Number(r.en_periodo),
    gastoTotal: Number(r.gasto_total),
    gastoEnPeriodo: Number(r.gasto_en_periodo)
  };
}

module.exports = { insertar, borrar, resumen };
