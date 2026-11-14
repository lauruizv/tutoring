-- Up Migration
-- 0005: precio de cada simulación. Es una copia congelada de lo que se le cobra a la empresa por esa simulación
-- en el momento en que se hizo: si después cambia la tarifa, las simulaciones viejas no se tocan.
-- Sin DEFAULT a propósito: así nadie inserta una simulación sin decir cuánto vale.
ALTER TABLE simulaciones
  ADD COLUMN precio_usd numeric(10, 2) NOT NULL CHECK (precio_usd >= 0);
