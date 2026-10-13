import { z } from "zod";
import { APP } from "./config.js";
import {
  getRecentResultSchema,
  type GetRecentResult,
  searchMessagesResultSchema,
  type SearchMessagesResult,
  type WechatMessage,
} from "./domain.js";

export const listChatsInput = z.object({});

export const searchMessagesInput = z.object({
  person: z.string().trim().min(1).max(APP.limits.maxSenderChars),
  keyword: z.string().optional(),
});

export const getRecentInput = z.object({
  person: z.string().trim().min(1).max(APP.limits.maxSenderChars),
  limit: z
    .number()
    .int()
    .min(1)
    .max(APP.limits.maxRecentLimit)
    .optional(),
});

export type SearchMessagesPayloadInput = {
  person: string;
  keyword: string | undefined;
  messages: WechatMessage[];
  availablePeople: string[];
};

export function buildSearchMessagesResult(input: SearchMessagesPayloadInput): SearchMessagesResult {
  const normalizedKeyword = (input.keyword ?? "").trim();
  return searchMessagesResultSchema.parse({
    person: input.person,
    keyword: normalizedKeyword.length > 0 ? normalizedKeyword : null,
    count: input.messages.length,
    truncated: input.messages.length >= APP.limits.maxSearchResults,
    availablePeople: input.availablePeople,
    messages: input.messages,
  });
}

export type GetRecentPayloadInput = {
  person: string;
  limit: number;
  messages: WechatMessage[];
  availablePeople: string[];
};

export function buildGetRecentResult(input: GetRecentPayloadInput): GetRecentResult {
  return getRecentResultSchema.parse({
    person: input.person,
    limit: input.limit,
    count: input.messages.length,
    availablePeople: input.availablePeople,
    messages: input.messages,
  });
}

export function resolveRecentLimit(limit: number | undefined): number {
  return limit ?? APP.limits.defaultRecentLimit;
}
