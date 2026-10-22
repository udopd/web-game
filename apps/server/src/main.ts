import "dotenv/config";
import { createApp } from "./app";
import { db } from "./db";
const { app } = await createApp();
await app.listen({
  port: Number(process.env.PORT ?? 3100),
  host: process.env.HOST ?? "127.0.0.1",
});
console.log(`Emberfall: ${process.env.APP_ORIGIN ?? "http://localhost:3100"}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
