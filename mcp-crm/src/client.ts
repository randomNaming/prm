import { APP } from "./config.js";
import { intakeResponseSchema, type IntakeResponse } from "./domain.js";

export type CrmClient = {
  /** 把一段聊天记录原文 POST 给平台 /api/intake。 */
  importChat: (payload: {
    person: string;
    file: string | null;
    text: string;
  }) => Promise<IntakeResponse>;
  /** 探测平台是否在线、智能体是否可用。 */
  status: () => Promise<{ reachable: boolean; agentEnabled: boolean; reason: string | null }>;
};

type ClientOptions = {
  baseUrl: string;
  intakeUrl: string;
  statusUrl: string;
};

export function describeNetworkError(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `请求 CRM 平台超时（超过 ${Math.round(APP.fetch.timeoutMs / 1000)} 秒）。记录较长或平台正在处理，可稍后重试或分批转发。`;
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED") {
      return `连接被拒绝：CRM 平台没有在监听 ${error.message.includes("http") ? "" : "该地址"}，请确认 nuxt dev / start 已启动。`;
    }
    return `请求 CRM 平台失败：${error.message}`;
  }
  return "请求 CRM 平台失败：未知错误。";
}

export function createCrmClient(options: ClientOptions): CrmClient {
  async function importChat(payload: {
    person: string;
    file: string | null;
    text: string;
  }): Promise<IntakeResponse> {
    const response = await fetch(options.intakeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(APP.fetch.timeoutMs),
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new Error(
        `CRM 平台返回 ${response.status}${response.statusText ? ` ${response.statusText}` : ""}：${raw.slice(0, 300)}`,
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new Error(`CRM 平台返回的不是 JSON：${raw.slice(0, 200)}`);
    }

    const parsed = intakeResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { ok: false, reason: "CRM 平台返回结构异常，请检查平台版本是否匹配。" };
    }

    return parsed.data;
  }

  async function status(): Promise<{
    reachable: boolean;
    agentEnabled: boolean;
    reason: string | null;
  }> {
    try {
      const response = await fetch(options.statusUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return { reachable: true, agentEnabled: false, reason: `平台在线但 /api/status 返回 ${response.status}。` };
      }

      const payload = (await response.json()) as {
        agentEnabled?: boolean;
        agentReason?: string;
      };

      return {
        reachable: true,
        agentEnabled: payload.agentEnabled === true,
        reason: payload.agentEnabled === true ? null : (payload.agentReason ?? "智能体不可用。"),
      };
    } catch (error) {
      return {
        reachable: false,
        agentEnabled: false,
        reason: describeNetworkError(error),
      };
    }
  }

  return { importChat, status };
}
