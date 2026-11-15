import type { Message, SendableChannels } from "discord.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { isTransient, lineText, mergeGroup } from "../src/bot/lines.js";
import { startActionLog } from "../src/bot/log.js";
import { BURIED_AFTER, adoptPlayer, followLogLine, livePlayer, postPlayer } from "../src/bot/player.js";
import { hasRecent, noteRecent, RECENT_SHOWN_MS, recentLine } from "../src/bot/recent.js";
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
  const queue = (id: string, by?: string) =>
    applyControl(session, { kind: "enqueue", tracks: [track(id)] }, by ? { by } : {});

  it("posts a line above the player and moves the player below it", async () => {
    await withPlayer();
    queue("e", "Bob");
    await flush();
    expect(transcript(channel)).toEqual(["-# Bob queued **title e** (#4)", "[player]"]);
  });

  it("skips silent actions and logs nothing without a player", async () => {
    queue("a", "Bob");
    await flush();
    expect(channel.send).not.toHaveBeenCalled();

    await postPlayer(asChannel(channel), session);
    applyControl(session, { kind: "enqueue", tracks: [track("b")] }, { by: "Bob", silent: true });
    await flush();
    expect(transcript(channel)).toEqual(["[player]"]);
  });

  it("shows passing actions on the player's footer instead of posting", async () => {
    await withPlayer();
    const player = channel.sent[0]!;
    applyControl(session, { kind: "pause" }, { by: "Bob" });
    applyControl(session, { kind: "skip" }, { by: "Ana", silent: true });
    applyControl(session, { kind: "reorder", from: 1, to: 0 }, { by: "Ana" });
    await flush();
    expect(transcript(channel)).toEqual(["[player]"]);
    expect(player.edit).toHaveBeenCalled();
    expect(recentLine(session.guildId)).toMatch(/^-# Ana moved \*\*title d\*\* to #1 · <t:\d+:R>$/);
  });

  it("merges the same person's repeats into the line above the player", async () => {
    await withPlayer();
    queue("e", "Bob");
    queue("f", "Bob");
    await flush();
    applyControl(session, { kind: "clear" }, { by: "Bob" });
    await flush();
    expect(transcript(channel)).toEqual(["-# Bob queued **title e**, **title f**", "-# Bob cleared 5 tracks", "[player]"]);
  });

  it("starts a new line for another person or once chat came in between", async () => {
    await withPlayer();
    queue("e", "Bob");
    await flush();
    queue("f", "Ana");
    await flush();
    await channel.send({ content: "hi" });
    queue("g", "Ana");
    await flush();
    expect(transcript(channel)).toEqual([
      "-# Bob queued **title e** (#4)",
      "-# Ana queued **title f** (#5)",
      "hi",
      "-# Ana queued **title g** (#6)",
      "[player]",
    ]);
  });

  it("anonymous and automatic actions never merge", async () => {
    await withPlayer();
    queue("e");
    await flush();
    queue("f");
    await flush();
    expect(transcript(channel)).toEqual(["-# Queued **title e** (#4)", "-# Queued **title f** (#5)", "[player]"]);
  });
});

describe("player footer", () => {
  it("stacks the same person's repeats and expires", () => {
    const guildId = `g${++guild}`;
    noteRecent(guildId, { kind: "remove", title: "a", by: "Bob" }, 1_000_000);
    noteRecent(guildId, { kind: "remove", title: "b", by: "Bob" }, 1_010_000);
    expect(recentLine(guildId, 1_010_000)).toBe("-# Bob removed **a**, **b** · <t:1010:R>");

    noteRecent(guildId, { kind: "pause", by: "Ana" }, 1_020_000);
    expect(recentLine(guildId, 1_020_000)).toBe("-# Ana paused · <t:1020:R>");
    expect(hasRecent(guildId)).toBe(true);
    expect(recentLine(guildId, 1_020_000 + RECENT_SHOWN_MS)).toBeUndefined();
    expect(hasRecent(guildId)).toBe(false);
  });
});

describe("merge rules", () => {
  it("keeps queue changes in chat and leaves passing actions to the footer", () => {
    expect(isTransient({ kind: "skip", title: "x" })).toBe(true);
    expect(isTransient({ kind: "reorder", title: "x", to: 1 })).toBe(true);
    expect(isTransient({ kind: "enqueue", title: "x", count: 1 })).toBe(false);
    expect(isTransient({ kind: "finished" })).toBe(false);
  });

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
