// Reglas de la grabación de una simulación. Lógica pura: no sabe de HTTP ni de dónde se guarda el audio.
"use strict";

const DIA_MS = 24 * 60 * 60 * 1000;

const esObjeto = v => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Lo que queda guardado de la aceptación de la grabación: qué texto leyó la persona (y su versión),
// si aceptó, cuándo lo dijo su navegador y cuándo lo recibió el servidor. null si no vino nada que sirva.
function consentimientoDe(c, ahora = Date.now()) {
  if (!esObjeto(c)) return null;
  const fecha = Date.parse(c.fecha);
  return {
    aceptado: c.aceptado === true,
    version: texto(c.version, 40),
    texto: texto(c.texto, 1200),
    fecha: Number.isNaN(fecha) ? null : new Date(fecha).toISOString(),
    registrado: new Date(ahora).toISOString()
  };
}

// ¿En el informe consta que la persona aceptó que se grabe?
const aceptoGrabar = informe => esObjeto(informe.consentimientoAudio) && informe.consentimientoAudio.aceptado === true;

// ¿El informe tiene un audio guardado? (`audio` también puede decir que ya se borró: { borrado, motivo }).
const tieneAudio = informe => esObjeto(informe.audio) && Boolean(informe.audio.bytes);

// ¿Ya pasó el plazo para guardar este audio? `audio` es lo que anota el servidor en el informe al recibirlo
// ({ bytes, subido, ... }). Un audio sin fecha legible se da por vencido: ante la duda, no se conserva.
function audioVencido(audio, ahora, dias) {
  if (!esObjeto(audio) || !audio.bytes) return false;   // no hay audio guardado
  const subido = Date.parse(audio.subido);
  return Number.isNaN(subido) || subido + dias * DIA_MS <= ahora;
}

// La duración que manda el navegador, en segundos enteros, o null si no es creíble.
function duracionValida(valor) {
  const n = Number(valor);
  return n > 0 && n < 6 * 3600 ? Math.round(n) : null;
}

module.exports = { consentimientoDe, aceptoGrabar, tieneAudio, audioVencido, duracionValida };
