import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { logger } from "../logger.js";
import { getOrCreateSessionForGuild } from "./store.js";
import { attachSocket } from "./ws.js";

const createSessionBody = z.object({
  guildId: z.string().min(1).max(64),
});

async function maybeServeStatic(app: FastifyInstance): Promise<void> {
  const distPath = path.resolve(process.cwd(), "web/dist");
  if (!existsSync(path.join(distPath, "index.html"))) {
    logger.info({ distPath }, "web/dist not built — skipping static serving");
    return;
  }
  await app.register(fastifyStatic, {
    root: distPath,
    prefix: "/",
    wildcard: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== "GET") {
      reply.code(404).send({ error: "not found" });
      return;
    }
    if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.sendFile("index.html");
  });
  logger.info({ distPath }, "serving web/dist");
}

export async function startServer(port: number): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(websocket);

  app.get("/health", async () => ({ ok: true }));

  app.post("/api/sessions", async (req, reply) => {
    const parsed = createSessionBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid body", details: parsed.error.issues };
    }
    const session = getOrCreateSessionForGuild(parsed.data.guildId);
    return { id: session.id, token: session.id };
  });

  app.get("/ws", { websocket: true }, (socket) => {
    attachSocket(socket);
  });

  await maybeServeStatic(app);

  await app.listen({ port, host: "0.0.0.0" });
  const address = app.server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  logger.info({ port: boundPort }, "state server: listening");

  return app;
}
