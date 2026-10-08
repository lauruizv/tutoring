/* Sesión simulada del login de demo (login.html).
   "Mantener sesión iniciada" → localStorage (sobrevive al cerrar el navegador);
   desmarcado → sessionStorage (se borra al cerrar la pestaña). */
window.T = window.T || {};
T.auth = (function () {
  "use strict";
  const KEY = "tutoring.session";
  const ROLES = ["empresa", "junior"];
  const stores = () => {
    const out = [];
    try { out.push(localStorage); } catch (_) {}
    try { out.push(sessionStorage); } catch (_) {}
    return out;
  };

  function get() {
    for (const s of stores()) {
      try {
        const v = JSON.parse(s.getItem(KEY));
        if (v && v.name && ROLES.includes(v.role)) return v;
        if (v) s.removeItem(KEY); // sesión vieja o inválida
      } catch (_) {}
    }
    return null;
  }

  function clear() {
    stores().forEach(s => { try { s.removeItem(KEY); } catch (_) {} });
  }

  // Devuelve false si el navegador no deja guardar (modo privado estricto, etc.).
  function set(session, remember) {
    clear();
    try {
      (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
      return true;
    } catch (_) { return false; }
  }

  return { get, set, clear };
})();
