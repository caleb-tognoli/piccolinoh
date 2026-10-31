import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { logger } from "../logger.js";
import { attachSocket } from "./ws.js";

const WEB_DIST = path.resolve(process.cwd(), "web/dist");

export async function startServer(port: number): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(websocket);
  app.get("/health", async () => ({ ok: true }));
  app.get("/ws", { websocket: true }, (socket) => attachSocket(socket));

  if (existsSync(path.join(WEB_DIST, "index.html"))) {
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
    // SPA fallback: the session id lives in the URL hash, so any GET serves the app.
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== "GET") return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  } else {
    logger.info({ distPath: WEB_DIST }, "web/dist not built — skipping static serving");
  }

  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port: (app.server.address() as { port: number }).port }, "server: listening");
  return app;
}
