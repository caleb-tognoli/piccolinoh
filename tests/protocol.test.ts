import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startServer } from "../src/watchtogether/boot.js";
import { resetStore } from "../src/watchtogether/store.js";

let app: FastifyInstance;
let port: number;

beforeEach(async () => {
  resetStore();
  app = await startServer(0);
  const addr = app.server.address() as AddressInfo;
  port = addr.port;
});

afterEach(async () => {
  await app.close();
});

async function createSession(guildId: string): Promise<{ id: string; token: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ guildId }),
  });
  return (await res.json()) as { id: string; token: string };
}

function openClient(): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ws`);
}

function once(ws: WebSocket, predicate: (msg: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for message")), 3_000);
    const onMessage = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString("utf8"));
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      }
    };
    ws.on("message", onMessage);
  });
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });
}

async function helloAndAwaitState(ws: WebSocket, token: string): Promise<any> {
  await waitOpen(ws);
  const p = once(ws, (m) => m.type === "state");
  ws.send(JSON.stringify({ type: "hello", sessionToken: token }));
  return p;
}

describe("state server protocol", () => {
  it("delivers identical state to two connected clients after enqueue+play", async () => {
    const { token } = await createSession("test-guild");
    const a = openClient();
    const b = openClient();

    const [stateA, stateB] = await Promise.all([
      helloAndAwaitState(a, token),
      helloAndAwaitState(b, token),
    ]);
    expect(stateA.session.epoch).toBe(0);
    expect(stateB.session.epoch).toBe(0);
    expect(stateA.session.current).toBeUndefined();

    const nextA = once(a, (m) => m.type === "state" && m.session.epoch === 1);
    const nextB = once(b, (m) => m.type === "state" && m.session.epoch === 1);

    a.send(
      JSON.stringify({
        type: "control",
        action: { kind: "enqueue", videoId: "abc", durationSec: 10 },
      }),
    );

    const [afterA, afterB] = await Promise.all([nextA, nextB]);
    expect(afterA.session.current?.videoId).toBe("abc");
    expect(afterB.session.current?.videoId).toBe("abc");
    expect(afterA.session.epoch).toBe(1);
    expect(afterB.session.epoch).toBe(1);

    a.close();
    b.close();
  });

  it("gives a late joiner a state message with a mid-track derived position", async () => {
    const { token } = await createSession("test-guild");
    const a = openClient();
    await helloAndAwaitState(a, token);

    const enqueued = once(a, (m) => m.type === "state" && m.session.current);
    a.send(
      JSON.stringify({
        type: "control",
        action: { kind: "enqueue", videoId: "long", durationSec: 60 },
      }),
    );
    const startedState = await enqueued;
    const startedAt = startedState.session.current.startedAtServerMs;

    await new Promise((r) => setTimeout(r, 1_200));

    const late = openClient();
    const lateState = await helloAndAwaitState(late, token);
    const derived = (lateState.serverMs - startedAt) / 1000;

    expect(lateState.session.current?.videoId).toBe("long");
    expect(derived).toBeGreaterThan(1);
    expect(derived).toBeLessThan(2);

    a.close();
    late.close();
  });

  it("auto-advances at track end and broadcasts the transition", async () => {
    const { token } = await createSession("test-guild");
    const a = openClient();
    const b = openClient();
    await Promise.all([helloAndAwaitState(a, token), helloAndAwaitState(b, token)]);

    const started = once(a, (m) => m.type === "state" && m.session.epoch === 1);
    a.send(
      JSON.stringify({
        type: "control",
        action: { kind: "enqueue", videoId: "x", durationSec: 1 },
      }),
    );
    await started;

    const advancedA = once(a, (m) => m.type === "state" && m.session.epoch === 2);
    const advancedB = once(b, (m) => m.type === "state" && m.session.epoch === 2);

    const [afterA, afterB] = await Promise.all([advancedA, advancedB]);
    expect(afterA.session.current).toBeUndefined();
    expect(afterB.session.current).toBeUndefined();
    expect(afterA.session.history.map((h: { videoId: string }) => h.videoId)).toEqual(["x"]);

    a.close();
    b.close();
  });
});
