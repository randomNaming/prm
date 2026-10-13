import { z } from "zod";
import { APP } from "./config.js";
import type { CrmClient } from "./client.js";
import type { ImportChatResult, IntakeStatusResult } from "./domain.js";
import { TEXT } from "./user-text.js";

export const importChatInput = z.object({
  person: z.string().trim().min(1).max(APP.limits.maxPersonChars),
  file: z.string().trim().max(APP.limits.maxFileChars).nullish(),
  text: z.string().trim().min(1),
});

export const intakeStatusInput = z.object({});

export type ImportChatArgs = z.infer<typeof importChatInput>;

export function buildImportChatResult(input: {
  person: string;
  file: string | null;
  text: string;
  response: Awaited<ReturnType<CrmClient["importChat"]>>;
}): ImportChatResult {
  const { response } = input;

  if (!response.ok) {
    return {
      delivered: true,
      accepted: false,
      person: input.person,
      file: input.file,
      chars: input.text.length,
      reason: response.reason ?? "平台未接受这条记录。",
      platform: null,
    };
  }

  return {
    delivered: true,
    accepted: true,
    person: input.person,
    file: input.file,
    chars: input.text.length,
    reason: null,
    platform: {
      conversation_id: response.conversationId ?? null,
      summary: response.summary ?? null,
      counts: response.counts ?? {},
      created_contacts: response.created?.contacts ?? [],
      created_companies: response.created?.companies ?? [],
    },
  };
}

export function buildImportChatError(input: {
  person: string;
  file: string | null;
  text: string;
  message: string;
}): ImportChatResult {
  return {
    delivered: false,
    accepted: false,
    person: input.person,
    file: input.file,
    chars: input.text.length,
    reason: input.message,
    platform: null,
  };
}

export function buildIntakeStatusResult(input: {
  baseUrl: string;
  status: Awaited<ReturnType<CrmClient["status"]>>;
}): IntakeStatusResult {
  return {
    reachable: input.status.reachable,
    agent_enabled: input.status.agentEnabled,
    base_url: input.baseUrl,
    reason: input.status.reason,
  };
}

export function describeTextArgument(): string {
  return `${TEXT.textArgument} ${TEXT.batchHint(APP.limits.defaultMaxTextLength)}`;
}
