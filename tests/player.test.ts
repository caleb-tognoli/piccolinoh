import type { Message, SendableChannels } from "discord.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { lineText, mergeGroup, startActionLog } from "../src/bot/log.js";
import { BURIED_AFTER, adoptPlayer, followLogLine, livePlayer, postPlayer } from "../src/bot/player.js";
import { applyControl } from "../src/watchtogether/control.js";
import { createSession, type Session } from "../src/watchtogether/session.js";
import { track } from "./helpers.js";

interface FakeMessage {
  id: string;
  guildId: string;
  channelId: string;
  channel: FakeChannel;
  content?: string;
  isPlayer: boolean;
  edit: Mock<(payload: { content?: string }) => Promise<FakeMessage>>;
  delete: Mock<() => Promise<FakeMessage>>;
}
interface FakeChannel {
  id: string;
  sent: FakeMessage[];
  /** Extra messages from other people, after everything sent. */
  chatter: number;
  isSendable: () => true;
  send: Mock<(payload: { content?: string }) => Promise<FakeMessage>>;
  messages: { fetch: Mock<(opts: { after: string; limit: number }) => Promise<unknown>> };
}

let nextId = 0;

function fakeChannel(guildId: string): FakeChannel {
  const channel: FakeChannel = {
    id: `c${++nextId}`,
    sent: [],
    chatter: 0,
    isSendable: () => true,
    send: vi.fn(async (payload) => {
      const message: FakeMessage = {
        id: String(++nextId),
        guildId,
        channelId: channel.id,
        channel,
        isPlayer: payload.content === undefined,
        ...(payload.content === undefined ? {} : { content: payload.content }),
        edit: vi.fn(async (p) => {
          if (p.content !== undefined) message.content = p.content;
          return message;
        }),
        delete: vi.fn(async () => {
          channel.sent.splice(channel.sent.indexOf(message), 1);
          return message;
        }),
      };
      channel.sent.push(message);
      return message;
    }),
    messages: {
      fetch: vi.fn(async ({ after, limit }) => {
        const newer = channel.sent.filter((m) => Number(m.id) > Number(after)).slice(0, limit);
        return { size: newer.length + channel.chatter, every: (f: (m: FakeMessage) => boolean) => newer.every(f) };
      }),
    },
  };
  return channel;
}

const asChannel = (c: FakeChannel) => c as unknown as SendableChannels;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
/** What the channel shows, top to bottom: log lines by text, the player as "[player]". */
const transcript = (c: FakeChannel) => c.sent.map((m) => (m.isPlayer ? "[player]" : m.content));

let session: Session;
let channel: FakeChannel;
let guild = 0;

beforeEach(() => {
  // A fresh guild per test keeps the modules' per-guild state apart.
  session = createSession(`g${++guild}`);
  channel = fakeChannel(session.guildId);
});

afterEach(() => {
  clearTimeout(session.advanceTimer);
});

describe("player", () => {
  it("a change plus a re-post in the same tick is one post, no edit", async () => {
    await postPlayer(asChannel(channel), session);
    const first = channel.sent[0]!;

    applyControl(session, { kind: "enqueue", tracks: [track("a")] }, { silent: true });
    expect(await postPlayer(asChannel(channel), session)).toBe(true);

    expect(first.edit).not.toHaveBeenCalled();
    expect(first.delete).toHaveBeenCalledOnce();
    expect(transcript(channel)).toEqual(["[player]"]);
    expect(livePlayer(session.guildId)?.id).toBe(channel.sent[0]!.id);
  });

  it("waits for `before` so the player lands below a reply", async () => {
    let land!: () => void;
    const reply = new Promise<void>((r) => (land = r));
    const posted = postPlayer(asChannel(channel), session, reply);
    await flush();
    expect(channel.send).not.toHaveBeenCalled();
    land();
    expect(await posted).toBe(true);
  });

  it("session changes edit in place, and identical renders are skipped", async () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a")] }, { silent: true });
    await postPlayer(asChannel(channel), session);
    const player = channel.sent[0]!;

    applyControl(session, { kind: "pause" }, { silent: true });
    await flush();
    expect(player.edit).toHaveBeenCalledOnce();

    applyControl(session, { kind: "seek", toSec: 5 });
    applyControl(session, { kind: "seek", toSec: 5 });
    await flush();
    expect(player.edit).toHaveBeenCalledTimes(2);
  });

  it("re-posts on automatic updates once buried, but not when a log line merged", async () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a"), track("b")] }, { silent: true });
    await postPlayer(asChannel(channel), session);
    channel.chatter = BURIED_AFTER;

    applyControl(session, { kind: "pause" }, { silent: true });
    await followLogLine(session, Promise.resolve(false));
    // A merged line counts as an edit, but the session change alone still checks for burial.
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]!.isPlayer).toBe(true);
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("drops a player whose message can't be edited", async () => {
    await postPlayer(asChannel(channel), session);
    channel.sent[0]!.edit.mockRejectedValueOnce(new Error("Unknown Message"));
    applyControl(session, { kind: "enqueue", tracks: [track("a")] }, { silent: true });
    await flush();
    expect(livePlayer(session.guildId)).toBeUndefined();
  });

  it("adopting a message makes it live and renders into it", async () => {
    const message = await channel.send({});
    adoptPlayer(message as unknown as Message, session);
    await flush();
    expect(livePlayer(session.guildId)?.id).toBe(message.id);
    expect(message.edit).toHaveBeenCalledOnce();
  });
});

describe("action log", () => {
  let stop: () => void;
  beforeAll(() => {
    stop = startActionLog();
  });
  afterAll(() => stop());

  async function withPlayer() {
    applyControl(session, { kind: "enqueue", tracks: ["a", "b", "c", "d"].map((id) => track(id)) }, { silent: true });
    await postPlayer(asChannel(channel), session);
  }

  it("posts a line above the player and moves the player below it", async () => {
    await withPlayer();
    applyControl(session, { kind: "pause" }, { by: "Bob" });
    await flush();
    expect(transcript(channel)).toEqual(["-# Bob paused", "[player]"]);
  });

  it("skips silent actions and logs nothing without a player", async () => {
    applyControl(session, { kind: "enqueue", tracks: [track("a")] }, { by: "Bob" });
    await flush();
    expect(channel.send).not.toHaveBeenCalled();

    await postPlayer(asChannel(channel), session);
    applyControl(session, { kind: "pause" }, { by: "Bob", silent: true });
    await flush();
    expect(transcript(channel)).toEqual(["[player]"]);
  });

  it("merges the same person's repeats into the line above the player", async () => {
    await withPlayer();
    applyControl(session, { kind: "remove", index: 0 }, { by: "Bob" });
    applyControl(session, { kind: "remove", index: 0 }, { by: "Bob" });
    await flush();
    applyControl(session, { kind: "pause" }, { by: "Bob" });
    applyControl(session, { kind: "play" }, { by: "Bob" });
    await flush();
    expect(transcript(channel)).toEqual(["-# Bob removed **title b**, **title c**", "-# Bob resumed", "[player]"]);
  });

  it("starts a new line for another person or once chat came in between", async () => {
    await withPlayer();
    applyControl(session, { kind: "pause" }, { by: "Bob" });
    await flush();
    applyControl(session, { kind: "play" }, { by: "Ana" });
    await flush();
    expect(transcript(channel)).toEqual(["-# Bob paused", "-# Ana resumed", "[player]"]);
  });

  it("anonymous and automatic actions never merge", async () => {
    await withPlayer();
    applyControl(session, { kind: "pause" });
    await flush();
    applyControl(session, { kind: "play" });
    await flush();
    expect(transcript(channel)).toEqual(["-# Paused", "-# Resumed", "[player]"]);
  });
});

describe("merge rules", () => {
  it("groups by kind, with reorders per track and playlists never", () => {
    expect(mergeGroup({ kind: "pause", by: "B" })).toBe(mergeGroup({ kind: "play", by: "B" }));
    expect(mergeGroup({ kind: "reorder", title: "x", to: 1, by: "B" })).not.toBe(
      mergeGroup({ kind: "reorder", title: "y", to: 1, by: "B" }),
    );
    expect(mergeGroup({ kind: "enqueue", title: "Mix", count: 3, by: "B" })).toBeUndefined();
    expect(mergeGroup({ kind: "skip", title: "x" })).toBeUndefined();
  });

  it("stacks titles, capped", () => {
    const titles = ["a", "b", "c", "d", "e", "f"];
    expect(lineText({ kind: "skip", title: "f", by: "Bob" }, titles)).toBe(
      "-# Bob skipped **a**, **b**, **c**, **d** +2 more",
    );
    expect(lineText({ kind: "reorder", title: "x", to: 1, by: "Bob" }, [])).toBe("-# Bob moved **x** to #1");
  });
});
