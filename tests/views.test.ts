import { describe as group, expect, it } from "vitest";
import {
  describe,
  esc,
  formatDuration,
  historyView,
  logLine,
  PAGE_SIZE,
  playerView,
  progressBar,
  queueEtas,
  queueView,
  type V2Message,
} from "../src/bot/views.js";
import { createSession, type Session } from "../src/watchtogether/session.js";
import { track } from "./helpers.js";

interface Node {
  type: number;
  content?: string;
  custom_id?: string;
  label?: string;
  disabled?: boolean;
  components?: Node[];
  accessory?: Node;
}

/** Builds the message (running discord.js validation) and flattens every component. */
function flatten(message: V2Message): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    out.push(n);
    n.components?.forEach(walk);
    if (n.accessory) walk(n.accessory);
  };
  message.components.forEach((c) => walk(c.toJSON() as Node));
  return out;
}

const texts = (m: V2Message) =>
  flatten(m)
    .map((n) => n.content)
    .filter(Boolean)
    .join("\n");
const buttons = (m: V2Message) => flatten(m).filter((n) => n.type === 2);

function playing(...queued: string[]): Session {
  const s = createSession("g");
  s.current = { ...track("cur", 222), startedAtServerMs: Date.now() };
  s.queue = queued.map((id) => track(id));
  return s;
}

group("formatting", () => {
  it("formats durations with hours when needed", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("escapes markdown and link brackets", () => {
    expect(esc("a_b [x]*")).toBe("a\\_b \\[x\\]\\*");
  });

  it("describes actions as verb phrases and log lines", () => {
    expect(describe({ kind: "skip", title: "A", by: "Caleb" })).toBe("skipped **A**");
    expect(describe({ kind: "enqueue", title: "Z", count: 1, position: 5 })).toBe("queued **Z** (#5)");
    expect(describe({ kind: "enqueue", title: "Mix", count: 24, position: 2 })).toBe("queued 24 tracks from **Mix**");
    expect(describe({ kind: "enqueue", title: "", count: 3 })).toBe("queued 3 tracks");
    expect(describe({ kind: "clear", count: 1 })).toBe("cleared 1 track");
    expect(logLine("skipped **A**", "Ca_leb")).toBe("-# Ca\\_leb skipped **A**");
    expect(logLine("queue finished")).toBe("-# Queue finished");
  });

  it("draws a progress bar", () => {
    expect(progressBar(0, 120)).toBe("`0:00` ●─────────── `2:00`");
    expect(progressBar(60, 120)).toBe("`1:00` ▬▬▬▬▬▬●───── `2:00`");
    expect(progressBar(500, 120)).toBe("`8:20` ▬▬▬▬▬▬▬▬▬▬▬● `2:00`");
  });
});

group("playerView", () => {
  it("shows now playing, progress, up next and controls, with no footer", () => {
    const s = playing("n1", "n2", "n3");
    s.current!.startedAtServerMs = 1_000_000;
    const view = playerView(s, 1_000_000 + 111_000);
    const t = texts(view);
    expect(t).toContain("▶ Now playing");
    expect(t).toContain("title cur");
    expect(t).toContain("`1:51` ▬▬▬▬▬▬●───── `3:42`");
    expect(t).toContain("Up next: **title n1** · +2 more");
    expect(t).not.toContain("Autoplay");
    expect(buttons(view).map((b) => b.label)).toEqual(["⏸ Pause", "⏭ Skip", "📋 Queue", "🔗 Join"]);
  });

  it("flips the toggle when paused and notes autoplay off", () => {
    const s = playing();
    s.current!.pausedAtPositionSec = 10;
    s.autoplay = false;
    const view = playerView(s);
    expect(texts(view)).toContain("⏸ Paused");
    expect(texts(view)).toContain("`0:10`");
    expect(texts(view)).toContain("-# Queue empty");
    expect(texts(view)).toContain("Autoplay off · stops after this track");
    expect(buttons(view)[0]!.label).toBe("▶ Resume");
  });

  it("offers 'Play next' when stopped with a queue", () => {
    const s = createSession("g");
    s.queue = [track("n1")];
    s.autoplay = false;
    const view = playerView(s);
    expect(texts(view)).toContain("⏹ Stopped");
    expect(buttons(view).map((b) => [b.label, b.custom_id])).toEqual([
      ["▶ Play next", "player:skip"],
      ["📋 Queue", "player:queue"],
      ["🔗 Join", "player:join"],
    ]);
  });

  it("collapses to an idle line", () => {
    const view = playerView(createSession("g"));
    expect(texts(view)).toBe("Nothing playing · `/play` to queue something");
    expect(buttons(view).map((b) => b.label)).toEqual(["🔗 Join"]);
  });
});

group("queueEtas", () => {
  it("counts down from the rest of the current track", () => {
    const s = playing("a", "b");
    s.current!.startedAtServerMs = 0;
    expect(queueEtas(s, 22_000)).toEqual([200, 210]);
  });

  it("is unknown while paused or with autoplay off", () => {
    const s = playing("a");
    s.autoplay = false;
    expect(queueEtas(s)).toBeUndefined();
    s.autoplay = true;
    s.current!.pausedAtPositionSec = 1;
    expect(queueEtas(s)).toBeUndefined();
  });
});

group("queueView", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `v${i}`);

  it("pages tracks with per-track buttons that name the track", () => {
    const view = queueView(playing(...ids), 1);
    const t = texts(view);
    expect(t).toContain("**Queue** · 12 tracks");
    expect(t).toContain("`6.` **title v5**");
    expect(t).toMatch(/`6\.` [^\n]* · \*in \d+:\d\d\*/);
    expect(t).not.toContain("`5.`");
    expect(t).not.toContain("`11.`");
    const b = buttons(view);
    expect(b.filter((x) => x.custom_id?.startsWith("queue:rm:"))).toHaveLength(PAGE_SIZE);
    expect(b.find((x) => x.custom_id === "queue:down:1:5:v5")).toBeDefined();
    expect(b.find((x) => x.label === "2/3")?.disabled).toBe(true);
  });

  it("disables moves that would leave the queue, and stays under the component cap", () => {
    const view = queueView(playing(...ids), 2);
    const b = buttons(view);
    expect(b.find((x) => x.custom_id === "queue:down:2:11:v11")?.disabled).toBe(true);
    expect(b.find((x) => x.label === "▶")?.disabled).toBe(true);
    const first = buttons(queueView(playing(...ids), 0));
    expect(first.find((x) => x.custom_id === "queue:top:0:0:v0")?.disabled).toBe(true);
    expect(first.find((x) => x.custom_id === "queue:up:0:0:v0")?.disabled).toBe(true);
    expect(flatten(queueView(playing(...ids), 0)).length).toBeLessThanOrEqual(40);
  });

  it("clamps out-of-range pages and uses unique custom ids", () => {
    const view = queueView(playing(...ids), 99);
    expect(texts(view)).toContain("`11.`");
    const customIds = buttons(view).map((b) => b.custom_id);
    expect(new Set(customIds).size).toBe(customIds.length);
  });

  it("says when the queue is empty and shows a notice", () => {
    const view = queueView(playing(), 0, "Removed **x**");
    expect(texts(view)).toContain("**Queue** is empty");
    expect(texts(view)).toContain("-# ✓ Removed **x**");
    expect(buttons(view).map((b) => b.label)).toEqual(["↻ Refresh"]);
  });
});

group("historyView", () => {
  it("lists newest first with re-queue buttons keyed to history indexes", () => {
    const s = createSession("g");
    s.history = Array.from({ length: 7 }, (_, i) => track(`h${i}`));
    const view = historyView(s, 0);
    const t = texts(view);
    expect(t.indexOf("title h6")).toBeLessThan(t.indexOf("title h2"));
    expect(t).not.toContain("title h1");
    expect(buttons(view)[0]!.custom_id).toBe("history:add:0:6:h6");
  });

  it("handles an empty history", () => {
    const view = historyView(createSession("g"), 0);
    expect(texts(view)).toBe("Nothing has played yet.");
    expect(buttons(view)).toHaveLength(0);
  });
});
