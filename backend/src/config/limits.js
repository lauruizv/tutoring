// Límites de tamaño (el contexto de la empresa puede traer documentos).
// audio: una llamada de 20 minutos (el máximo de un escenario) comprimida pesa unos 4 MB.
const LIMITS = { empresa: 8_000_000, informe: 4_000_000, audio: 10_000_000, mensajes: 4_000_000, maxTokens: 8192, mensajesCant: 80, caracteresPorMensaje: 400_000 };
// Cuántos días se guarda la grabación de una simulación. El texto que acepta el candidato dice el mismo número.
const AUDIO_DIAS = 90;
module.exports = { LIMITS, AUDIO_DIAS };
