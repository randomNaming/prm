import { z } from "zod";
import { APP } from "./config.js";

/**
 * 转发给 CRM 平台的载荷。
 * 只有三个字段——本服务刻意不定义消息级结构，也不做解析。
 */
export const importChatInput = z.object({
  person: z.string().trim().min(1).max(APP.limits.maxPersonChars),
  file: z.string().trim().max(APP.limits.maxFileChars).nullish(),
  text: z.string().trim().min(1),
});

export type ImportChatInput = z.infer<typeof importChatInput>;

/** 平台 /api/intake 的返回形状。字段做宽松校验：平台可能只增不改，缺字段时降级展示。 */
export const intakeResponseSchema = z.object({
  ok: z.boolean(),
  disabled: z.boolean().optional(),
  reason: z.string().optional(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  summary: z.string().optional(),
  counts: z.record(z.string(), z.number()).optional(),
  created: z
    .object({
      contacts: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
      companies: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    })
    .optional(),
});

export type IntakeResponse = z.infer<typeof intakeResponseSchema>;

/** 工具最终返回给 MCP 客户端的形状。 */
export const importChatResultSchema = z.object({
  delivered: z.boolean(),
  accepted: z.boolean(),
  person: z.string(),
  file: z.string().nullable(),
  chars: z.number().int().nonnegative(),
  reason: z.string().nullable(),
  platform: z
    .object({
      conversation_id: z.string().nullable(),
      summary: z.string().nullable(),
      counts: z.record(z.string(), z.number()),
      created_contacts: z.array(z.object({ id: z.string(), name: z.string() })),
      created_companies: z.array(z.object({ id: z.string(), name: z.string() })),
    })
    .nullable(),
});

export type ImportChatResult = z.infer<typeof importChatResultSchema>;

export const intakeStatusResultSchema = z.object({
  reachable: z.boolean(),
  agent_enabled: z.boolean(),
  base_url: z.string(),
  reason: z.string().nullable(),
});

export type IntakeStatusResult = z.infer<typeof intakeStatusResultSchema>;
