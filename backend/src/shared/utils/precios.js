// Precios de los modelos, en dólares por millón de tokens. Sirven para calcular el costo en el log.
// Si Google o Anthropic cambian los precios, se cambian acá y nada más.

// Gemini Live (https://ai.google.dev/gemini-api/docs/pricing, plan pago, captura del 2026-11-03).
// La misma tabla vale para gemini-3.8-live, gemini-3.8-live-extended-thinking y gemini-3.1-flash-live-preview.
// Los tokens de pensamiento se cobran como salida; se toman a la tarifa de salida de texto.
const GEMINI_LIVE = {
  entrada: { texto: 0.75, audio: 3.0, imagen: 1.0 },
  salida: { texto: 4.5, audio: 12.0 },
  pensamiento: 4.5
};
const MODELOS_GEMINI_LIVE = /^(models\/)?gemini-(3\.8-live|3\.8-live-extended-thinking|3\.1-flash-live-preview)$/;

// Claude (API de Anthropic, https://platform.claude.com/docs/en/about-claude/pricing, consultado el 2026-11-03).
// Escribir en el caché de 5 minutos cuesta 1,25 veces la entrada y leerlo, 0,1 veces.
// Con el proveedor `claude-sdk` (tu suscripción) no se paga por token: el número es lo que costaría por la API.
const claude = (entrada, salida) => ({ entrada, salida, cacheEscritura: entrada * 1.25, cacheLectura: entrada * 0.1 });
const CLAUDE = {
  "claude-sonnet-5-5": claude(2, 10),
  "claude-sonnet-5": claude(2, 10),
  "claude-haiku-5-5": claude(0.1, 0.5),   // hasta 100K tokens de entrada
  "claude-haiku-4-5": claude(1, 5)
};
// Alias que usa Claude Code (CLAUDE_SDK_MODEL*): se toma la generación actual de cada familia.
const ALIAS_CLAUDE = { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" };

const preciosClaude = modelo => {
  const m = String(modelo || "").toLowerCase().replace(/-\d{8}$/, "");   // claude-haiku-4-5-20251001 → claude-haiku-4-5
  return CLAUDE[ALIAS_CLAUDE[m] || m] || null;
};
const usd = n => Math.round(n * 1e6) / 1e6;
const num = v => Math.max(0, Number(v) || 0);

// Costo de una llamada de Gemini Live. `uso` es lo que manda el navegador (ver voice.js).
// Devuelve { total, entrada, salida } en dólares, o null si el modelo no tiene precio cargado.
function costoLive(modelo, uso) {
  if (!MODELOS_GEMINI_LIVE.test(String(modelo || ""))) return null;
  const P = GEMINI_LIVE;
  const eTexto = num(uso.entradaTexto), eAudio = num(uso.entradaAudio);
  const eResto = Math.max(0, num(uso.entrada) - eTexto - eAudio);   // otras modalidades: se toman como texto
  const sAudio = num(uso.salidaAudio), sTexto = num(uso.salidaTexto);
  const sResto = Math.max(0, num(uso.salida) - sAudio - sTexto);
  const entrada = (eTexto * P.entrada.texto + eAudio * P.entrada.audio + eResto * P.entrada.texto) / 1e6;
  const salida = ((sAudio) * P.salida.audio + (sTexto + sResto) * P.salida.texto + num(uso.pensamiento) * P.pensamiento) / 1e6;
  return { total: usd(entrada + salida), entrada: usd(entrada), salida: usd(salida) };
}

// Costo de una consulta a Claude. `t` = { in, out, cacheWrite, cacheRead } como los arma cada proveedor
// (`in` ya incluye lo del caché). Devuelve dólares, o null si el modelo no tiene precio cargado.
function costoClaude(modelo, t) {
  const p = preciosClaude(modelo);
  if (!p || !t || (t.in == null && t.out == null)) return null;
  const w = num(t.cacheWrite), r = num(t.cacheRead);
  const normales = Math.max(0, num(t.in) - w - r);
  return usd((normales * p.entrada + w * p.cacheEscritura + r * p.cacheLectura + num(t.out) * p.salida) / 1e6);
}

// "US$0.0123" (4 decimales; por debajo de un centésimo se ven centésimos de centavo).
const textoUsd = n => "US$" + n.toFixed(4);

module.exports = { GEMINI_LIVE, CLAUDE, ALIAS_CLAUDE, costoLive, costoClaude, textoUsd };
