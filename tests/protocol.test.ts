import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { signJoinToken } from "../src/joinToken.js";
import { applyControl } from "../src/watchtogether/control.js";
import { startServer } from "../src/watchtogether/server.js";
import type { Session } from "../src/watchtogether/session.js";
import { getOrCreateSessionForGuild, resetStore } from "../src/watchtogether/store.js";
import { track } from "./helpers.js";

let app: FastifyInstance;
let port: number;
let session: Session;

beforeEach(async () => {
  resetStore();
  session = getOrCreateSessionForGuild("test-guild");
  app = await startServer(0);
  port = (app.server.address() as AddressInfo).port;
});

afterEach(async () => {
  resetStore();
  await app.close();
});

function next(ws: WebSocket, predicate: (msg: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for message")), 3_000);
    const onMessage = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString("utf8"));
      if (!predicate(msg)) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(msg);
    };
    ws.on("message", onMessage);
  });
}

async function join(joinToken?: string): Promise<{ ws: WebSocket; state: any }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const state = next(ws, (m) => m.type === "state");
  ws.send(JSON.stringify({ type: "hello", sessionId: session.id, ...(joinToken ? { joinToken } : {}) }));
  return { ws, state: await state };
}

describe("state server protocol", () => {
  it("broadcasts identical state to all clients when the bot enqueues", async () => {
    const [a, b] = await Promise.all([join(), join()]);
    expect(a.state.session.epoch).toBe(0);
    expect(a.state.session.current).toBeUndefined();

    const nextA = next(a.ws, (m) => m.type === "state" && m.session.epoch === 1);
    const nextB = next(b.ws, (m) => m.type === "state" && m.session.epoch === 1);
    applyControl(session, { kind: "enqueue", tracks: [track("abc")] });

    const [afterA, afterB] = await Promise.all([nextA, nextB]);
    expect(afterA.session.current?.videoId).toBe("abc");
    expect(afterB.session.current?.title).toBe("title abc");
  });

  it("gives a late joiner a state message with a mid-track position", async () => {
    applyControl(session, { kind: "enqueue", tracks: [track("long", 60)] });
    const startedAt = session.current!.startedAtServerMs;
    await new Promise((r) => setTimeout(r, 1_200));

    const { state } = await join();
    const derived = (state.serverMs - startedAt) / 1000;
    expect(state.session.current?.videoId).toBe("long");
    expect(derived).toBeGreaterThan(1);
    expect(derived).toBeLessThan(2);
  });

  it("auto-advances at track end and broadcasts the transition", async () => {
    const { ws } = await join();
    const advanced = next(ws, (m) => m.type === "state" && m.session.epoch === 2);
    applyControl(session, { kind: "enqueue", tracks: [track("x", 1)] });
    const after = await advanced;
    expect(after.session.current).toBeUndefined();
    expect(after.session.history.map((h: { videoId: string }) => h.videoId)).toEqual(["x"]);
  });

  it("applies browser controls but ignores enqueue from browsers", async () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a", 60)] });
    const { ws } = await join();
    ws.send(JSON.stringify({ type: "control", action: { kind: "enqueue", tracks: [track("evil")] } }));
    const paused = next(ws, (m) => m.type === "state" && m.session.current?.pausedAtPositionSec != null);
    ws.send(JSON.stringify({ type: "control", action: { kind: "pause" } }));
    const state = await paused;
    expect(state.session.queue).toHaveLength(0);
  });

  it("lets a browser undo a removal but not restore arbitrary videos", async () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a", 60), track("b"), track("c")] });
    const { ws } = await join();
    const queueIs = (ids: string[]) =>
      next(ws, (m) => m.type === "state" && m.session.queue.map((t: { videoId: string }) => t.videoId).join() === ids.join());
    const removed = queueIs(["c"]);
    ws.send(JSON.stringify({ type: "control", action: { kind: "remove", index: 0 } }));
    await removed;
    const restored = queueIs(["b", "c"]);
    ws.send(JSON.stringify({ type: "control", action: { kind: "restore", videoId: "evil" } }));
    ws.send(JSON.stringify({ type: "control", action: { kind: "restore", videoId: "b" } }));
    await restored;
    expect(session.queue.map((t) => t.videoId)).toEqual(["b", "c"]);
  });

  it("shows the display name from a valid join token in presence", async () => {
    const token = signJoinToken({ sid: session.id, gid: session.guildId, dn: "Alice" });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const presence = next(ws, (m) => m.type === "presence");
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "hello", sessionId: session.id, joinToken: token }));
    expect((await presence).members).toEqual([{ id: expect.any(String), displayName: "Alice" }]);
  });
});
