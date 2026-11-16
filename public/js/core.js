/* Lógica pura, sin DOM: historial, parseo de la evaluación, puntaje y corte de
   oraciones para la voz. Está en un archivo aparte para poder probarla con
   `npm test` (funciona igual en el navegador y en Node). */
(function (raiz) {
  "use strict";

  // ---------------------------------------------------------------- historial
  // El modelo exige que los mensajes alternen user/assistant y empiecen en user.
  // Junta los seguidos del mismo rol, descarta los vacíos y corta los primeros si hacen falta.
  function normalizarHistorial(lista, maximo) {
    const out = [];
    (Array.isArray(lista) ? lista : []).forEach(m => {
      if (!m) return;
      const role = m.role === "assistant" ? "assistant" : "user";
      const content = String(m.content == null ? "" : m.content).trim();
      if (!content) return;
      const last = out[out.length - 1];
      if (last && last.role === role) last.content += "\n\n" + content;
      else out.push({ role, content });
    });
    // Primero recortamos por cantidad y después aseguramos que arranque en user:
    // al revés, el recorte podría volver a dejar un assistant al principio.
    const cortado = maximo > 0 ? out.slice(-maximo) : out;
    while (cortado.length && cortado[0].role !== "user") cortado.shift();
    return cortado;
  }

  // ---------------------------------------------------------------- evaluación
  const LISTAS = ["fortalezas", "a_mejorar", "como_encaro", "preguntas_entrevista"];

  // Intenta sacar el objeto JSON de la respuesta del modelo, aunque venga con
  // texto alrededor, en un bloque ``` o con alguna coma de más.
  function extraerJSON(texto) {
    const t = String(texto == null ? "" : texto).trim();
    if (!t) return null;
    const candidatos = [t];
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) candidatos.push(fence[1]);
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) candidatos.push(t.slice(a, b + 1));
    for (const c of candidatos) {
      const limpio = c.trim();
      if (!limpio) continue;
      for (const intento of [limpio, limpio.replace(/,\s*([}\]])/g, "$1")]) {
        try { const v = JSON.parse(intento); if (v && typeof v === "object") return v; } catch (_) {}
      }
    }
    return null;
  }

  const texto1 = v => (v == null ? "" : Array.isArray(v) ? v.map(texto1).filter(Boolean).join(" ") : typeof v === "object" ? "" : String(v).trim());
  const lista1 = v => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(texto1).filter(Boolean);

  // Deja la evaluación con la forma que espera el informe. Devuelve null si no hay criterios.
  function parseEvaluacion(texto) {
    const raw = extraerJSON(texto);
    if (!raw) return null;
    const crits = Array.isArray(raw.criterios) ? raw.criterios
      : Array.isArray(raw.criterias) ? raw.criterias
        : Array.isArray(raw.evaluacion && raw.evaluacion.criterios) ? raw.evaluacion.criterios : null;
    if (!crits || !crits.length) return null;
    const ev = {
      resumen: texto1(raw.resumen || raw.summary),
      criterios: crits.filter(Boolean).map(c => ({
        nombre: texto1(c.nombre || c.criterio || c.name),
        puntaje: puntajeCriterio(c.puntaje != null ? c.puntaje : c.score),
        observado: texto1(c.observado),
        evidencia: texto1(c.evidencia || c.cita || c.evidence),
        comentario: texto1(c.comentario || c.comment),
        paraSubir: texto1(c.paraSubir || c.para_subir)
      })),
      expresion: texto1(raw.expresion)
    };
    LISTAS.forEach(k => { ev[k] = lista1(raw[k]); });
    return ev;
  }

  // ---------------------------------------------------------------- puntaje
  // Acepta 4, "4", "4/5", "4,5" o "puntaje 4". Devuelve un entero de 1 a 5, o null.
  function puntajeCriterio(valor) {
    if (valor == null) return null;
    let n = typeof valor === "number" ? valor : NaN;
    if (!Number.isFinite(n)) {
      const m = String(valor).replace(",", ".").match(/-?\d+(\.\d+)?/);
      if (!m) return null;
      n = Number(m[0]);
    }
    if (!Number.isFinite(n)) return null;
    n = Math.round(n);
    if (n < 1 || n > 5) return null;
    return n;
  }

  function sinAcentos(s) {
    const t = String(s == null ? "" : s);
    return t.normalize ? t.normalize("NFD").replace(/[̀-ͯ]/g, "") : t;
  }
  const clave = s => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // Busca en la evaluación el criterio que definió el senior: primero por nombre
  // (sin importar acentos ni mayúsculas) y, si no aparece, por posición.
  function buscarCriterio(def, i, evaluados) {
    const k = clave(def && def.nombre);
    let r = k ? (evaluados || []).find(x => clave(x && x.nombre) === k) : null;
    if (!r && k) r = (evaluados || []).find(x => { const k2 = clave(x && x.nombre); return k2 && (k2.indexOf(k) === 0 || k.indexOf(k2) === 0); });
    if (!r && (evaluados || []).length === (def && def.total)) r = evaluados[i];
    return r || null;
  }

  // Lo que vale cada nivel de 1 a 5 en la escala de 0 a 100. El 3 ("cumple, lo hace bien")
  // vale 65 y no 50: un 50/100 se lee como un fracaso aunque la persona haya hecho bien la tarea.
  const VALOR_NIVEL = [null, 0, 35, 65, 85, 100];

  // Puntaje de 0 a 100 ponderado por el peso de cada criterio.
  // Solo promedia los criterios que el modelo realmente puntuó e informa la cobertura,
  // para que el informe pueda avisar si quedó incompleto.
  function puntajePonderado(definidos, evaluados) {
    const defs = Array.isArray(definidos) ? definidos : [];
    const evs = Array.isArray(evaluados) ? evaluados : [];
    let num = 0, den = 0, cubiertos = 0;
    defs.forEach((c, i) => {
      const r = buscarCriterio({ nombre: c && c.nombre, total: defs.length }, i, evs);
      const p = puntajeCriterio(r && r.puntaje);
      if (p == null) return;
      let peso = Number(c && c.peso);
      if (!Number.isFinite(peso) || peso <= 0) peso = 1;
      num += VALOR_NIVEL[p] * peso; den += peso; cubiertos++;
    });
    return { puntaje: den ? Math.round(num / den) : null, cubiertos, total: defs.length };
  }

  // ---------------------------------------------------------------- voz
  // Limpia lo que no se tiene que leer en voz alta.
  // El acento rioplatense a veces se cuela en la transcripción de la voz ("Sho te shamé").
  // Se corrigen palabras comunes y las raíces de "llamar", "llegar", "llenar" y "llevar";
  // "show" o "shopping" no se tocan.
  const SHEISMO = {
    sho: "yo", sha: "ya", shendo: "yendo", esha: "ella", eshas: "ellas", esho: "ello", eshos: "ellos",
    cashe: "calle", cashes: "calles", ashá: "allá", ashí: "allí", asher: "ayer", ashuda: "ayuda", masho: "mayo",
    shuvia: "lluvia", shave: "llave", shaves: "llaves",
    ehtá: "está", ehtás: "estás", ehtoy: "estoy", ehtamos: "estamos", ehto: "esto", ehta: "esta", mihmo: "mismo", mihma: "misma"
  };
  const comoEn = (orig, nueva) => orig === orig.toUpperCase() && orig.length > 1 ? nueva.toUpperCase()
    : orig[0] === orig[0].toUpperCase() ? nueva[0].toUpperCase() + nueva.slice(1) : nueva;
  function sinSheismo(t) {
    return t.replace(/(?<!\p{L})\p{L}+(?!\p{L})/gu, p => {
      const min = p.toLowerCase();
      if (SHEISMO[min]) return comoEn(p, SHEISMO[min]);
      if (/^sh(am|eg|en|ev)/.test(min)) return comoEn(p, "ll" + min.slice(2));
      return p;
    });
  }

  function textoHablable(t) {
    return sinSheismo(String(t == null ? "" : t))
      .replace(/\[\s*FIN\s*\]/gi, " ")
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .replace(/\*\*?|[_#`>~]/g, "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const FIN_ORACION = /[.!?…](["»”’)]+)?(\s|$)/g;
  const CORTE_BLANDO = /[,;:—]\s/g;

  // Cuánto del texto pendiente conviene mandar a la síntesis de voz.
  // - `forzar`: ya llegó todo, se manda lo que quede.
  // - si no hay punto todavía pero se acumuló mucho, corta en una coma o en un espacio:
  //   así el cliente simulado empieza a hablar antes y la espera se siente más corta.
  function largoDecible(pendiente, forzar, minimo) {
    const t = String(pendiente == null ? "" : pendiente);
    if (!t) return 0;
    if (forzar) return t.length;
    const min = minimo || 0;
    let corte = 0, m;
    FIN_ORACION.lastIndex = 0;
    while ((m = FIN_ORACION.exec(t))) corte = m.index + m[0].length;
    if (corte > 0 && corte >= min) return corte;
    if (t.length < 140) return corte;
    let blando = 0;
    CORTE_BLANDO.lastIndex = 0;
    while ((m = CORTE_BLANDO.exec(t))) { if (m.index + m[0].length <= 220) blando = m.index + m[0].length; }
    if (blando >= 30) return blando;
    const esp = t.lastIndexOf(" ", 200);
    return esp > 30 ? esp + 1 : corte;
  }

  // ---------------------------------------------------------------- filtros de los informes
  // De los días que elige la persona ("2026-11-10", en su hora) a los instantes que entiende el servidor.
  // `desde` es el comienzo de ese día y `hasta`, el comienzo del día siguiente (el servidor lo deja afuera):
  // así "hasta el 10" incluye todo el 10. Un día vacío o que no existe queda en "".
  function rangoDeDias(desde, hasta) {
    const comienzo = (dia, sumar) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia == null ? "" : String(dia));
      if (!m) return "";
      const [anio, mes, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
      const fecha = new Date(anio, mes, d);
      // new Date acepta el 31 de febrero y lo corre a marzo: si no quedó el día pedido, no existe.
      if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes || fecha.getDate() !== d) return "";
      return new Date(anio, mes, d + sumar).toISOString();
    };
    return { desde: comienzo(desde, 0), hasta: comienzo(hasta, 1) };
  }

  // ---------------------------------------------------------------- audio de la llamada
  // Cuando la llamada se graba, cada turno guarda en qué segundo de la grabación empieza y termina (t0 y t1),
  // para que el informe pueda hacer sonar el momento de una cita.

  const decima = n => Math.round(n * 10) / 10;
  // Un turno hablado más corto que esto no puede ser: nadie dice una frase en menos de medio segundo.
  const MIN_TURNO_SEG = 0.5;

  // Calcula los tiempos de cada turno a partir de los eventos que ya emite el motor de voz.
  // `ahora` es el segundo de la grabación en que pasó cada cosa; null si no se está grabando.
  //
  // El cliente: su turno empieza cuando empieza a sonar y termina cuando se cierra.
  // El candidato: su texto no sirve para saber cuándo empezó, porque Gemini Live lo manda cuando termina
  // de hablar. Su turno empieza donde terminó el turno anterior (habla cuando el cliente se calla) y
  // termina cuando llega su último texto; lo que sigue es la espera hasta que el cliente contesta.
  function cronometroDeTurnos() {
    let empezoElCliente = null;                       // cuándo empezó a sonar el cliente
    let primerTexto = null, ultimoTexto = null;       // cuándo llegó el texto del candidato
    let finAnterior = 0;                              // dónde terminó el último turno cerrado
    return {
      // Se le avisa cada evento del motor.
      evento(ev, ahora) {
        if (!ev || ahora == null) return;
        if (ev.type === "interim" && ev.text) {
          if (primerTexto == null) primerTexto = ahora;
          ultimoTexto = ahora;
        }
        const hablaElCliente = (ev.type === "partial" && ev.text) || (ev.type === "state" && ev.state === "speaking");
        if (hablaElCliente && empezoElCliente == null) empezoElCliente = ahora;
      },
      // Al cerrarse un turno devuelve { t0, t1 }, o null si de ese turno no hay audio:
      // no se estaba grabando, o el candidato lo escribió con el teclado.
      cerrar(role, ahora) {
        let desde, hasta = ahora;
        if (role === "user") {
          // Si interrumpió al cliente, su texto pudo llegar antes de que se cerrara el turno del cliente.
          desde = primerTexto == null ? null : Math.min(finAnterior, primerTexto);
          // Si el texto llegó pegado al comienzo no dice cuándo terminó de hablar: vale el cierre del turno.
          if (ultimoTexto - desde >= MIN_TURNO_SEG) hasta = Math.min(ultimoTexto, ahora);
          primerTexto = ultimoTexto = null;
        } else {
          desde = empezoElCliente;
          empezoElCliente = null;
        }
        if (ahora == null) return null;
        if (desde == null) { finAnterior = ahora; return null; }
        const t0 = decima(Math.max(0, desde)), t1 = decima(hasta);
        finAnterior = hasta;
        return t1 > t0 ? { t0, t1 } : null;
      }
    };
  }

  // Sin tildes, mayúsculas ni signos: para comparar una cita con lo que quedó en la transcripción.
  const llano = s => (s == null ? "" : String(s)).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // Un número se escribe corto y se dice largo: "38.000" son 6 letras y "treinta y ocho mil", 18. Para estimar
  // cuánto tarda en decirse un texto, los números se cuentan como se dicen.
  const HASTA_29 = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
    "dieciseis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidos", "veintitres", "veinticuatro", "veinticinco", "veintiseis", "veintisiete", "veintiocho", "veintinueve"];
  const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  function hasta999(n) {
    if (n === 0) return "cero";
    if (n === 100) return "cien";
    const resto = n % 100;
    const decenas = !resto ? "" : resto < 30 ? HASTA_29[resto] : DECENAS[Math.floor(resto / 10)] + (resto % 10 ? " y " + HASTA_29[resto % 10] : "");
    return [CENTENAS[Math.floor(n / 100)], decenas].filter(Boolean).join(" ");
  }
  // Hasta seis cifras, como una cantidad ("seis mil trescientos treinta y tres"). Uno más largo (un DNI, un
  // número de gestión) o que empieza con cero se dicta cifra por cifra ("ocho ocho uno dos…").
  const MAX_CIFRAS_DE_CANTIDAD = 6;
  function numeroDicho(cifras) {
    if (cifras.length > MAX_CIFRAS_DE_CANTIDAD || (cifras.length > 1 && cifras[0] === "0")) return cifras.split("").map(c => HASTA_29[c]).join(" ");
    const n = Number(cifras), miles = Math.floor(n / 1000), resto = n % 1000;
    if (!miles) return hasta999(n);
    return (miles === 1 ? "" : hasta999(miles) + " ") + "mil" + (resto ? " " + hasta999(resto) : "");
  }
  // El texto como se dice en voz alta, sin tildes ni signos: su largo en letras da una idea de cuánto dura.
  // El punto de los miles ("38.000") no separa dos números.
  const comoSeDice = t => llano((t == null ? "" : String(t)).replace(/(\d)\.(?=\d{3}(?!\d))/g, "$1").replace(/\d+/g, numeroDicho));

  // Cuántas palabras de `cita` aparecen en el mismo orden, aunque haya otras en el medio, en las primeras
  // j palabras de `texto`: devuelve la cuenta para cada j (la última es la del texto entero).
  function enOrdenHasta(cita, texto) {
    let fila = new Array(texto.length + 1).fill(0);
    for (let i = 1; i <= cita.length; i++) {
      const nueva = [0];
      for (let j = 1; j <= texto.length; j++) nueva[j] = cita[i - 1] === texto[j - 1] ? fila[j - 1] + 1 : Math.max(fila[j], nueva[j - 1]);
      fila = nueva;
    }
    return fila;
  }
  const palabrasEnOrden = (cita, texto) => enOrdenHasta(cita, texto)[texto.length];

  // En qué parte del texto de un turno está una cita: { desde, hasta }, de 0 (el comienzo) a 1 (el final),
  // contado en letras. `partes` y `texto` vienen como se dicen (comoSeDice), para que un número pese lo que dura.
  function parteDelTurno(partes, texto) {
    // Las partes que están tal cual marcan el lugar exacto.
    const lugares = partes.map(parte => ({ parte, en: (" " + texto + " ").indexOf(" " + parte + " ") })).filter(x => x.en >= 0);
    if (lugares.length) {
      return { desde: Math.min(...lugares.map(x => x.en)) / texto.length, hasta: Math.max(...lugares.map(x => x.en + x.parte.length)) / texto.length };
    }
    // Si no, el tramo más corto que tiene, en orden, todas las palabras que coinciden: termina en la primera
    // palabra que las completa y empieza lo más tarde que se pueda.
    const deLaCita = partes.join(" ").split(" "), delTexto = texto.split(" ");
    const cuenta = enOrdenHasta(deLaCita, delTexto), todas = cuenta[delTexto.length];
    if (!todas) return { desde: 0, hasta: 1 };
    const fin = cuenta.indexOf(todas);
    const ini = fin - enOrdenHasta(deLaCita.slice().reverse(), delTexto.slice(0, fin).reverse()).indexOf(todas);
    const letrasHasta = n => delTexto.slice(0, n).join(" ").length;
    return { desde: ini ? (letrasHasta(ini) + 1) / texto.length : 0, hasta: letrasHasta(fin) / texto.length };
  }
  // Para aceptar una cita que no está tal cual: cuántas de sus palabras tienen que aparecer en orden,
  // y qué parte de la cita son. Con menos, dos frases cualesquiera se parecen por las palabras comunes ("que", "de", "la").
  const MIN_PALABRAS_EN_ORDEN = 4, MIN_PARECIDO = 0.75;
  // Una cita así de corta ("Disculpame") solo vale si está en un único turno: si está en varios, sería adivinar.
  const PALABRAS_DE_CITA_CORTA = 2;

  // Busca en qué turno del candidato está una cita del informe. Devuelve { indice, t0, t1, desde, hasta } o null:
  // el turno, sus tiempos y en qué parte de su texto está la cita (ver parteDelTurno).
  // Solo mira los turnos del candidato que tienen audio. La cita puede venir recortada, con otros signos,
  // con puntos suspensivos en el medio o con alguna palabra cambiada. Si no se parece lo suficiente a
  // ningún turno, no se adivina: null (y el informe no muestra el botón para escucharla).
  function ubicarCita(turnos, cita) {
    // El evaluador puede saltear un pedazo con "…" o "[...]": cada parte se busca por separado.
    const crudas = (cita == null ? "" : String(cita)).split(/\s*(?:\[\s*(?:\.{3}|…)\s*\]|\(\s*(?:\.{3}|…)\s*\)|\.{3,}|…)\s*/).filter(parte => llano(parte));
    const partes = crudas.map(llano);
    if (!partes.length) return null;
    const letras = partes.reduce((n, parte) => n + parte.length, 0);
    const palabrasDeLaCita = partes.join(" ").split(" ");
    let mejor = null, empatados = 0;
    (Array.isArray(turnos) ? turnos : []).forEach((t, indice) => {
      if (!t || t.role !== "user" || !Number.isFinite(t.t0) || !Number.isFinite(t.t1) || t.t1 <= t.t0) return;
      const texto = llano(t.text);
      if (!texto) return;
      // Puntaje de 0 a 1: qué parte de la cita está, tal cual y con palabras enteras, en este turno.
      let puntaje = partes.filter(parte => (" " + texto + " ").includes(" " + parte + " ")).reduce((n, parte) => n + parte.length, 0) / letras;
      if (!puntaje) {
        const enOrden = palabrasEnOrden(palabrasDeLaCita, texto.split(" "));
        const parecido = enOrden / palabrasDeLaCita.length;
        if (enOrden >= MIN_PALABRAS_EN_ORDEN && parecido >= MIN_PARECIDO) puntaje = parecido * 0.9;   // siempre por debajo de una coincidencia exacta
      }
      if (!puntaje) return;
      if (!mejor || puntaje > mejor.puntaje) { mejor = { indice, t0: t.t0, t1: t.t1, puntaje, crudo: t.text }; empatados = 1; }
      else if (puntaje === mejor.puntaje) empatados++;   // con la misma coincidencia queda el primero
    });
    if (!mejor || (palabrasDeLaCita.length <= PALABRAS_DE_CITA_CORTA && empatados > 1)) return null;
    return Object.assign({ indice: mejor.indice, t0: mejor.t0, t1: mejor.t1 }, parteDelTurno(crudas.map(comoSeDice), comoSeDice(mejor.crudo)));
  }

  // Cada cuánto se mide el volumen de la grabación para buscar la voz, en segundos.
  const PASO_VOLUMEN_SEG = 0.05;
  // Hay voz cuando el volumen pasa esta parte del volumen fuerte del turno, y nunca por debajo del piso
  // (el soplido de fondo de un micrófono). Así da igual que la persona hable alto o bajo.
  const PARTE_DEL_VOLUMEN_FUERTE = 0.15, PISO_DE_VOZ = 0.01;

  // Una frase casi siempre empieza después de una pausa. Si la voz vuelve después de un silencio así de largo
  // a esta distancia o menos del comienzo estimado de la cita, la cita arranca ahí.
  const PAUSA_SEG = 0.25, CERCA_DE_UNA_PAUSA_SEG = 0.8;

  // En qué tramitos del volumen hay voz: la lista de sus posiciones.
  function marcosConVoz(niveles) {
    const fuerte = niveles.slice().sort((a, b) => a - b)[Math.floor(niveles.length * 0.9)];
    const umbral = Math.max(PISO_DE_VOZ, fuerte * PARTE_DEL_VOLUMEN_FUERTE);
    const conVoz = [];
    niveles.forEach((nivel, i) => { if (nivel > umbral) conVoz.push(i); });
    return conVoz;
  }
  const centesima = n => Math.round(n * 100) / 100;

  // De un turno, qué segundos hay que hacer sonar para escuchar una cita. No sabe qué palabra suena en cada
  // momento: saca los silencios (antes de empezar a hablar, las pausas, la espera del final) y reparte el
  // texto sobre lo hablado. Si la cita ocupa la segunda mitad del texto, es la segunda mitad de lo hablado.
  // Es una estimación: quien la usa le suma un margen.
  //   niveles: el volumen del turno, un valor cada `paso` segundos.
  //   tramo: lo que devuelve ubicarCita ({ t0, t1, desde, hasta }).
  // Devuelve { t0, t1 }, en segundos de la grabación. Si no distingue ninguna voz, el turno entero.
  function tramoDeCita(niveles, paso, tramo) {
    const entero = { t0: tramo.t0, t1: tramo.t1 };
    if (!Array.isArray(niveles) || !niveles.length || !(paso > 0)) return entero;
    const conVoz = marcosConVoz(niveles);
    if (!conVoz.length) return entero;
    const parte = (valor, siFalta) => (Number.isFinite(valor) ? Math.min(1, Math.max(0, valor)) : siFalta);
    let primero = conVoz[Math.min(conVoz.length - 1, Math.floor(parte(tramo.desde, 0) * conVoz.length))];
    const ultimo = conVoz[Math.max(0, Math.ceil(parte(tramo.hasta, 1) * conVoz.length) - 1)];
    if (ultimo < primero) return entero;
    // Donde la voz vuelve después de una pausa: si hay uno cerca del comienzo estimado, ese es el comienzo.
    const vueltas = conVoz.filter((marco, i) => i === 0 || (marco - conVoz[i - 1] - 1) * paso >= PAUSA_SEG - 1e-9);
    const cerca = vueltas.filter(marco => marco <= ultimo && Math.abs(marco - primero) * paso <= CERCA_DE_UNA_PAUSA_SEG)
      .sort((a, b) => Math.abs(a - primero) - Math.abs(b - primero))[0];
    if (cerca !== undefined) primero = cerca;
    return { t0: centesima(tramo.t0 + primero * paso), t1: centesima(Math.min(tramo.t1, tramo.t0 + (ultimo + 1) * paso)) };
  }

  // Para iluminar la cita mientras suena: en qué segundo de la grabación empieza cada palabra de `texto`.
  // `niveles` es el volumen del tramo que suena (desde el segundo t0, un valor cada `paso` segundos). Reparte
  // las palabras sobre lo hablado, cada una según lo que tarda en decirse. Es una estimación, como tramoDeCita.
  // Devuelve un tiempo por palabra (separadas por espacios), o [] si no hay volumen o no hay texto.
  function tiemposDePalabras(niveles, paso, t0, texto) {
    const palabras = (texto == null ? "" : String(texto)).split(/\s+/).filter(Boolean);
    if (!Array.isArray(niveles) || !niveles.length || !palabras.length) return [];
    let marcos = marcosConVoz(niveles);
    if (!marcos.length) marcos = niveles.map((_, i) => i);   // sin voz a la vista: parejo sobre todo el tramo
    const pesos = palabras.map(palabra => comoSeDice(palabra).length + 1);   // el 1 es el espacio
    const total = pesos.reduce((a, b) => a + b, 0);
    let dicho = 0;
    return pesos.map(peso => {
      const marco = marcos[Math.min(marcos.length - 1, Math.floor(dicho / total * marcos.length))];
      dicho += peso;
      return centesima(t0 + marco * paso);
    });
  }

  // ---------------------------------------------------------------- configuración de la empresa
  // Contextos generales: siempre presentes (se pueden dejar vacíos, no borrar).
  const GENERALES = [
    { clave: "proposito", titulo: "Propósito del negocio", ayuda: "Qué hace la empresa, para quién y para qué existe." },
    { clave: "oferta", titulo: "Productos o servicios y clientes", ayuda: "Qué vendés u ofrecés, quiénes son tus clientes y qué valoran." },
    { clave: "trabajo", titulo: "Cómo trabajamos", ayuda: "Procesos, roles, horarios, herramientas y metodología." },
    { clave: "problemas", titulo: "Cómo encaramos un problema", ayuda: "El orden de pasos que esperás cuando algo sale mal." },
    { clave: "clientes", titulo: "Trato con clientes", ayuda: "Cómo se le habla a un cliente y qué no se hace nunca." },
    { clave: "calidad", titulo: "Criterios de calidad", ayuda: "Qué se revisa antes de dar algo por terminado." },
    { clave: "restricciones", titulo: "Restricciones", ayuda: "Lo que no se hace sin la persona responsable." }
  ];
  const ACCIONES_JUNIOR = ["entender", "trabajo", "tarea", "revisar"];
  // Del formato viejo (secciones fijas pensadas para software) al nuevo.
  const MAPA_VIEJO = { proposito: "proposito", producto: "oferta", metodologia: "trabajo", problemas: "problemas", clientes: "clientes", revision: "calidad", restricciones: "restricciones" };
  const TITULOS_VIEJOS = { arquitectura: "Arquitectura y módulos" };

  const str = v => (v == null ? "" : String(v));
  let secuencia = 0;
  const nuevoId = pref => `${pref}-${Date.now().toString(36)}${(secuencia++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  const esFormatoViejo = cfg => Boolean(cfg) && typeof cfg === "object" && !Array.isArray(cfg.contextos) && cfg.contexto && typeof cfg.contexto === "object";

  // Convierte el formato viejo ({ contexto: {proposito, producto, ...}, archivos, senior }) al nuevo, sin perder nada.
  function migrarConfig(cfg) {
    if (!cfg || typeof cfg !== "object") return null;
    if (!esFormatoViejo(cfg)) return normalizarConfig(cfg);
    const viejo = cfg.contexto || {};
    const contextos = GENERALES.map(g => {
      const claveVieja = Object.keys(MAPA_VIEJO).find(k => MAPA_VIEJO[k] === g.clave);
      return { id: "g-" + g.clave, clave: g.clave, titulo: g.titulo, contenido: str(viejo[claveVieja]).trim(), general: true };
    });
    Object.keys(viejo).forEach(k => {
      if (MAPA_VIEJO[k] || !str(viejo[k]).trim()) return;
      contextos.push({ id: "p-" + k.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), titulo: TITULOS_VIEJOS[k] || k, contenido: str(viejo[k]).trim(), general: false });
    });
    const nuevo = Object.assign({}, cfg, {
      version: 2,
      rubro: cfg.rubro || "Software",
      responsable: { nombre: str(cfg.senior).trim(), rol: "Líder técnico" },
      contextos,
      documentos: Array.isArray(cfg.archivos) ? cfg.archivos : []
    });
    delete nuevo.contexto; delete nuevo.archivos; delete nuevo.senior;
    return normalizarConfig(nuevo);
  }

  // Deja la configuración completa y ordenada: generales primero (todos, en su orden) y después los particulares.
  function normalizarConfig(cfg) {
    const c = Object.assign({}, cfg);
    c.version = 2;
    c.empresa = str(c.empresa);
    c.rubro = str(c.rubro);
    const r = c.responsable && typeof c.responsable === "object" ? c.responsable : { nombre: str(c.senior), rol: "" };
    c.responsable = { nombre: str(r.nombre), rol: str(r.rol) };
    delete c.senior;
    const lista = (Array.isArray(c.contextos) ? c.contextos : []).filter(x => x && typeof x === "object");
    const generales = GENERALES.map(g => {
      const x = lista.find(y => y.general && y.clave === g.clave) || {};
      return { id: str(x.id) || "g-" + g.clave, clave: g.clave, titulo: str(x.titulo).trim() || g.titulo, contenido: str(x.contenido), general: true };
    });
    const particulares = lista.filter(y => !(y.general && GENERALES.some(g => g.clave === y.clave)))
      .map(y => ({ id: str(y.id) || nuevoId("p"), titulo: str(y.titulo), contenido: str(y.contenido), general: false }));
    c.contextos = generales.concat(particulares);
    const docs = Array.isArray(c.documentos) ? c.documentos : Array.isArray(c.archivos) ? c.archivos : [];
    c.documentos = docs.filter(d => d && d.nombre).map(d => ({ nombre: str(d.nombre), contenido: str(d.contenido) }));
    delete c.archivos; delete c.contexto;
    const te = c.tareaEjemplo;
    const obj = te && typeof te === "object" ? te : { tarea: str(te) };
    c.tareaEjemplo = {};
    ACCIONES_JUNIOR.forEach(k => { c.tareaEjemplo[k] = str(obj[k]); });
    c.escenarios = Array.isArray(c.escenarios) ? c.escenarios : [];
    c.criterios = Array.isArray(c.criterios) ? c.criterios : [];
    c.notasEvaluacion = str(c.notasEvaluacion);
    // La voz del cliente suena como por teléfono (filtro de Gemini Live). Prendida salvo que la apaguen.
    c.vozTelefonica = c.vozTelefonica !== false;
    return c;
  }

  // Texto de un contexto general por su clave ("" si está vacío).
  const contextoDe = (cfg, clave) => {
    const x = ((cfg && cfg.contextos) || []).find(c => c.general && c.clave === clave);
    return x ? str(x.contenido).trim() : "";
  };
  // "Martín Sosa (líder técnico)" o solo el nombre si no hay rol.
  function responsableTexto(cfg) {
    const r = (cfg && cfg.responsable) || {};
    const nombre = str(r.nombre).trim() || str(cfg && cfg.senior).trim() || "la persona responsable";
    const rol = str(r.rol).trim();
    return rol ? `${nombre} (${rol.charAt(0).toLowerCase() + rol.slice(1)})` : nombre;
  }
  const esSoftware = cfg => /software|sistemas|tecnolog|desarrollo|programaci|inform[aá]tica|\bit\b|saas/i.test(str(cfg && cfg.rubro));

  const api = { normalizarHistorial, extraerJSON, parseEvaluacion, puntajeCriterio, puntajePonderado, buscarCriterio, clave, textoHablable, largoDecible, rangoDeDias, cronometroDeTurnos, comoSeDice, ubicarCita, tramoDeCita, tiemposDePalabras, PASO_VOLUMEN_SEG,
    GENERALES, ACCIONES_JUNIOR, esFormatoViejo, migrarConfig, normalizarConfig, contextoDe, responsableTexto, esSoftware, nuevoId };

  if (typeof module === "object" && module.exports) module.exports = api;
  else { raiz.T = raiz.T || {}; raiz.T.core = api; }
})(typeof window !== "undefined" ? window : globalThis);
