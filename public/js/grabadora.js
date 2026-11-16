/* Audio de la simulación: la grabadora (durante la llamada) y el reproductor de fragmentos (en el informe).

   Ninguna de las dos conoce al resto de la app:
   - La grabadora recibe del motor de voz los sonidos que hay que grabar y devuelve un archivo al terminar.
     No sabe de llamadas ni de informes.
   - El reproductor recibe una función que baja el audio y hace sonar el tramo que le pidan.
     No sabe de dónde sale el audio ni qué es una cita.

   Solo se graba si el candidato lo aceptó en el brief (ver la casilla en app.js). */
window.T = window.T || {};

T.audio = (function () {
  const AC = window.AudioContext || window.webkitAudioContext;

  // Opus es el formato que menos pesa para la voz (unos 200 KB por minuto). Si el navegador no lo graba, el primero que tenga.
  const FORMATOS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const formato = () => (typeof MediaRecorder === "undefined" ? "" : FORMATOS.find(f => MediaRecorder.isTypeSupported(f)) || "");
  const sePuedeGrabar = () => Boolean(AC && formato());
  const sePuedeEscuchar = () => Boolean(AC);

  const BITS_POR_SEGUNDO = 32000;
  const CADA_MS = 1000;         // cada cuánto la grabadora entrega lo grabado: si algo falla, se pierde a lo sumo esto
  // Se escucha un poco antes y un poco después del tramo pedido, para no comerse una palabra. Antes es menos:
  // lo que suena ahí es lo que la persona dijo justo antes de la cita.
  const MARGEN_ANTES_SEG = 0.5, MARGEN_DESPUES_SEG = 1;
  const HZ_AL_ESCUCHAR = 16000; // para la voz alcanza, y el audio decodificado ocupa un tercio de la memoria

  // ------------------------------------------------------------------ grabadora
  // Uso: el motor de voz llama a conectar() cuando tiene el audio listo; la app llama a empezar() cuando la
  // llamada se atiende. Se graba recién cuando pasaron las dos cosas, así no queda grabado el timbre ni la espera.
  function crearGrabadora() {
    let ctx = null, destino = null, llaveMic = null, grabador = null, comienzo = null;
    let pedida = false, micAbierto = true, final = null;
    const partes = [];

    function arrancarSiCorresponde() {
      if (grabador || !destino || !pedida || final) return;
      try { grabador = new MediaRecorder(destino.stream, { mimeType: formato(), audioBitsPerSecond: BITS_POR_SEGUNDO }); }
      catch (_) { grabador = null; return; }   // este navegador no puede: la llamada sigue, sin grabarse
      grabador.ondataavailable = e => { if (e.data && e.data.size) partes.push(e.data); };
      grabador.start(CADA_MS);
      comienzo = ctx.currentTime;
    }

    return {
      // El motor entrega su contexto de audio y los dos sonidos: el micrófono y la voz del cliente.
      // Se mezclan en un solo canal. El micrófono pasa por una llave para poder silenciarlo.
      conectar(contexto, { mic, cliente }) {
        if (destino || final) return;
        ctx = contexto;
        destino = ctx.createMediaStreamDestination();
        destino.channelCount = 1;
        destino.channelCountMode = "explicit";
        llaveMic = ctx.createGain();
        llaveMic.gain.value = micAbierto ? 1 : 0;
        llaveMic.connect(destino);
        if (mic) mic.connect(llaveMic);
        if (cliente) cliente.connect(destino);
        arrancarSiCorresponde();
      },

      // La llamada se atendió: desde acá se graba.
      empezar() { pedida = true; arrancarSiCorresponde(); },

      // Con el micrófono silenciado, la voz del candidato tampoco queda grabada.
      micAbierto(abierto) {
        micAbierto = Boolean(abierto);
        if (llaveMic) llaveMic.gain.value = micAbierto ? 1 : 0;
      },

      get grabando() { return Boolean(grabador && grabador.state === "recording"); },

      // En qué segundo de la grabación estamos; null si no se está grabando.
      ahora() { return grabador && !final ? ctx.currentTime - comienzo : null; },

      // Frena y devuelve una promesa con { blob, mime, duracionSeg }, o null si no se grabó nada.
      // Hay que llamarla ANTES de cerrar el contexto de audio: si se cierra primero, la grabadora no llega a
      // entregar el último tramo y queda colgada. Se puede llamar más de una vez: devuelve siempre lo mismo.
      terminar() {
        if (final) return final;
        const duracionSeg = this.ahora();
        final = new Promise(resolver => {
          if (!grabador || grabador.state === "inactive") return resolver(null);
          const mime = grabador.mimeType || formato();
          grabador.onstop = () => resolver(partes.length ? { blob: new Blob(partes, { type: mime }), mime, duracionSeg } : null);
          grabador.onerror = () => resolver(null);
          try { grabador.stop(); } catch (_) { resolver(null); }
        });
        return final;
      }
    };
  }

  // ------------------------------------------------------------------ reproductor de fragmentos
  // bajar(): promesa con el audio completo (ArrayBuffer). Se llama una sola vez, la primera vez que se pide un tramo.
  // No se usa <audio> porque estas grabaciones no traen índice ni duración: saltar a un segundo no es confiable.
  // Se decodifica el archivo entero y se hace sonar el tramo exacto. La memoria se libera con cerrar().
  function crearReproductor(bajar) {
    let ctx = null, audio = null, cargando = null, fuente = null, alDejarDeSonar = null, cerrado = false;
    let sonandoDesde = null;   // { reloj, segundo }: en qué momento del reloj del audio empezó a sonar qué segundo

    function cargar() {
      if (!cargando) {
        cargando = (async () => {
          const datos = await bajar();
          ctx = new AC({ sampleRate: HZ_AL_ESCUCHAR });
          audio = await ctx.decodeAudioData(datos);
          return audio;
        })();
        cargando.catch(() => { cargando = null; });   // si falló (sin conexión, por ejemplo), el próximo clic lo reintenta
      }
      return cargando;
    }

    function parar() {
      if (!fuente) return;
      const f = fuente, avisar = alDejarDeSonar;
      fuente = null; alDejarDeSonar = null; sonandoDesde = null;
      f.onended = null;
      try { f.stop(); } catch (_) {}
      if (avisar) avisar();
    }

    return {
      // Hace sonar del segundo t0 al t1 de la grabación, con un margen a cada lado.
      // alTerminar() se llama cuando deja de sonar: porque terminó, porque se pidió otro tramo o porque se paró.
      async tocar(t0, t1, alTerminar) {
        parar();
        const completo = await cargar();
        if (cerrado) return;
        parar();   // mientras cargaba pudo haber arrancado otro tramo
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const desde = Math.max(0, Math.min(t0 - MARGEN_ANTES_SEG, completo.duration));
        const hasta = Math.min(completo.duration, t1 + MARGEN_DESPUES_SEG);
        if (hasta - desde < 0.05) { if (alTerminar) alTerminar(); return; }
        const f = ctx.createBufferSource();
        f.buffer = completo;
        f.connect(ctx.destination);
        fuente = f; alDejarDeSonar = alTerminar || null;
        f.onended = () => {
          if (fuente !== f) return;
          const avisar = alDejarDeSonar;
          fuente = null; alDejarDeSonar = null; sonandoDesde = null;
          if (avisar) avisar();
        };
        f.start(0, desde, hasta - desde);
        sonandoDesde = { reloj: ctx.currentTime, segundo: desde };
      },
      parar,
      // Qué segundo de la grabación está sonando ahora; null si no suena nada.
      segundo: () => (sonandoDesde && ctx ? sonandoDesde.segundo + (ctx.currentTime - sonandoDesde.reloj) : null),
      // El volumen de la grabación entre los segundos t0 y t1: un valor cada `paso` segundos.
      // Sirve para encontrar dónde hay voz (core.tramoDeCita). Baja y decodifica el audio si hace falta.
      async volumen(t0, t1, paso) {
        const completo = await cargar();
        const muestras = completo.getChannelData(0), porPaso = Math.max(1, Math.round(completo.sampleRate * paso));
        const fin = Math.min(muestras.length, Math.round(t1 * completo.sampleRate)), niveles = [];
        for (let i = Math.max(0, Math.round(t0 * completo.sampleRate)); i < fin; i += porPaso) {
          const hasta = Math.min(fin, i + porPaso);
          let suma = 0;
          for (let j = i; j < hasta; j++) suma += muestras[j] * muestras[j];
          niveles.push(Math.sqrt(suma / (hasta - i)));
        }
        return niveles;
      },
      // Deja de sonar y suelta el audio decodificado (ocupa unos 2 MB por minuto).
      cerrar() {
        cerrado = true;
        parar();
        sonandoDesde = null;
        if (ctx) ctx.close().catch(() => {});
        ctx = null; audio = null; cargando = null;
      }
    };
  }

  return { sePuedeGrabar, sePuedeEscuchar, crearGrabadora, crearReproductor };
})();
