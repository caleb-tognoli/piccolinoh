import { z } from "zod";

// Browsers get transport controls and queue removal (with undo, which only
// restores a recently removed track); adding and reordering tracks goes
// through the Discord bot.
const browserControlSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("play") }),
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("skip") }),
  z.object({ kind: z.literal("seek"), toSec: z.number().min(0) }),
  z.object({ kind: z.literal("remove"), index: z.number().int().min(0) }),
  z.object({ kind: z.literal("restore"), videoId: z.string().min(1).max(64) }),
]);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    sessionId: z.string().min(1),
    joinToken: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("ping"), t0: z.number() }),
  z.object({ type: z.literal("control"), action: browserControlSchema }),
  z.object({
    type: z.literal("playbackError"),
    videoId: z.string().min(1).max(64),
    code: z.number().int(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
