// Quién puede ver un informe. Lógica pura: la usan el servicio de informes y el de audios.
// La empresa ve todos; estudiante y junior, solo los suyos.
"use strict";

// Sobre un informe ya leído.
const loVe = (yo, informe) => yo.rol === "empresa" || (Boolean(informe.usuarioId) && informe.usuarioId === yo.id);

// Lo mismo, dicho para una lista: el repositorio trae solo lo que entra en este alcance.
const alcanceDe = yo => (yo.rol === "empresa" ? { todos: true } : { usuarioId: yo.id });

// El mail de quien hizo la simulación. Solo lo tienen las cuentas que entran con Google (Postgres): ahí el
// "usuario" de la sesión es el mail. Una cuenta con contraseña tiene un nombre de usuario, no un mail: queda "".
const emailDe = yo => (yo && yo.empresaId && typeof yo.usuario === "string" && yo.usuario.includes("@") ? yo.usuario : "");

module.exports = { loVe, alcanceDe, emailDe };
