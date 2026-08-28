import { Connectors, Constants, Shoukaku, type NodeOption } from "shoukaku";
import type { Client } from "discord.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

export class LavalinkNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LavalinkNotReadyError";
  }
}

export function attachShoukaku(client: Client): void {
  const nodes: NodeOption[] = [
    {
      name: "main",
      url: `${config.LAVALINK_HOST}:${config.LAVALINK_PORT}`,
      auth: config.LAVALINK_PASSWORD,
      secure: config.LAVALINK_SECURE,
    },
  ];

  const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes);

  shoukaku.on("ready", (name, reconnected) => {
    logger.info({ node: name, reconnected }, "node connected");
  });
  shoukaku.on("error", (name, err) => {
    logger.error({ node: name, err }, "node error");
  });
  shoukaku.on("close", (name, code, reason) => {
    logger.warn({ node: name, code, reason }, "node closed");
  });
  shoukaku.on("disconnect", (name, count) => {
    logger.warn({ node: name, count }, "node disconnected");
  });

  client.shoukaku = shoukaku;
}

export function awaitShoukakuReady(client: Client, timeoutMs: number): Promise<void> {
  const alreadyConnected = [...client.shoukaku.nodes.values()].some(
    (n) => n.state === Constants.State.CONNECTED,
  );
  if (alreadyConnected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;

    const onReady = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.shoukaku.off("ready", onReady);
      resolve();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.shoukaku.off("ready", onReady);
      reject(new LavalinkNotReadyError(`lavalink not ready after ${timeoutMs}ms`));
    }, timeoutMs);

    client.shoukaku.on("ready", onReady);
  });
}
