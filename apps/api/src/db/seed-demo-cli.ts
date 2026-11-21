import { loadEnv } from "../config/env.js";
import { createDb } from "./client.js";
import { seedDemo } from "./seed-demo.js";

const env = loadEnv();
const { client, db } = createDb(env.DATABASE_URL);

try {
  await seedDemo(db);
  console.log("Datos demo cargados: Casa Roble, Taller Lino y Panadería Dulce Trigo");
} finally {
  await client.end();
}
