// Quién puede ver un informe. Lógica pura: la usan el servicio de informes y el de audios.
// La empresa ve todos; estudiante y junior, solo los suyos.
"use strict";

// Sobre un informe ya leído.
const loVe = (yo, informe) => yo.rol === "empresa" || (Boolean(informe.usuarioId) && informe.usuarioId === yo.id);

// Lo mismo, dicho para una lista: el repositorio trae solo lo que entra en este alcance.
const alcanceDe = yo => (yo.rol === "empresa" ? { todos: true } : { usuarioId: yo.id });

module.exports = { loVe, alcanceDe };
