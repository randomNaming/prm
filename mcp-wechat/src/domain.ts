import { z } from "zod";
import { APP } from "./config.js";

export const directionSchema = z.enum(["in", "out"]);
export type Direction = z.infer<typeof directionSchema>;

export const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

export const messageHeaderSchema = z.object({
  at: timestampSchema,
  sender: z.string().trim().min(1).max(APP.limits.maxSenderChars),
});
export type MessageHeader = z.infer<typeof messageHeaderSchema>;

export const messageSchema = z.object({
  person: z.string(),
  direction: directionSchema,
  sender: z.string(),
  text: z.string(),
  at: timestampSchema,
});
export type WechatMessage = z.infer<typeof messageSchema>;

export const chatSummarySchema = z.object({
  person: z.string(),
  file: z.string(),
  messages: z.number().int().nonnegative(),
  firstAt: timestampSchema.nullable(),
  lastAt: timestampSchema.nullable(),
});
export type ChatSummary = z.infer<typeof chatSummarySchema>;

export const searchMessagesResultSchema = z.object({
  person: z.string(),
  keyword: z.string().nullable(),
  count: z.number().int().nonnegative(),
  truncated: z.boolean(),
  availablePeople: z.array(z.string()),
  messages: z.array(messageSchema),
});
export type SearchMessagesResult = z.infer<typeof searchMessagesResultSchema>;

export const getRecentResultSchema = z.object({
  person: z.string(),
  limit: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  availablePeople: z.array(z.string()),
  messages: z.array(messageSchema),
});
export type GetRecentResult = z.infer<typeof getRecentResultSchema>;

const selfSenderKeys = new Set(APP.senders.self.map((name) => name.toLowerCase()));

export function directionFromSender(sender: string): Direction {
  return selfSenderKeys.has(sender.trim().toLowerCase()) ? "out" : "in";
}

export function isSelfSender(sender: string): boolean {
  return directionFromSender(sender) === "out";
}
