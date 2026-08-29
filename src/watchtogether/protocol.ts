import { z } from "zod";

const videoIdSchema = z.string().min(1).max(64);
const durationSchema = z.number().positive().max(24 * 60 * 60);

export const controlActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("play") }),
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("skip") }),
  z.object({ kind: z.literal("seek"), toSec: z.number().min(0) }),
  z.object({
    kind: z.literal("enqueue"),
    videoId: videoIdSchema,
    durationSec: durationSchema,
  }),
  z.object({ kind: z.literal("remove"), index: z.number().int().min(0) }),
  z.object({
    kind: z.literal("reorder"),
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  }),
]);
export type ControlAction = z.infer<typeof controlActionSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), sessionToken: z.string().min(1) }),
  z.object({ type: z.literal("ping"), t0: z.number() }),
  z.object({ type: z.literal("requestState") }),
  z.object({ type: z.literal("control"), action: controlActionSchema }),
  z.object({
    type: z.literal("playbackError"),
    videoId: videoIdSchema,
    code: z.number().int(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
