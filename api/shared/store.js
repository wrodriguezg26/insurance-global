"use strict";
/* Elige el almacenamiento: Azure SQL (por defecto) o memoria (STORE=memory, solo para pruebas locales). */
module.exports = process.env.STORE === "memory" ? require("./store-mem") : require("./store-sql");
