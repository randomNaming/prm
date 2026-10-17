import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { agentCapability, env } from "../server/utils/env";
import { CONFIG } from "../server/utils/config";

export class AgentDisabledError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "AgentDisabledError";
	}
}

/**
 * 每次模型 HTTP 请求单独限时：一轮导入/研究内部有最多 12 步「请求→执行工具→再请求」，
 * 总耗时几分钟是正常的；超时只该管「单次请求被远端吊住」，不该把整轮掐死。
 * 与调用方自己的 abortSignal（如有）合并，任何一个触发都会中止。
 */
function limitedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
	const requestTimeout = AbortSignal.timeout(CONFIG.agent.requestTimeoutMs);
	const signal = init?.signal
		? AbortSignal.any([requestTimeout, init.signal])
		: requestTimeout;

	return fetch(input, { ...init, signal });
}

// SDK 的 fetch 契约带一个可选的 preconnect 钩子，本包装不需要预热连接。
limitedFetch.preconnect = async () => {};

export function agentModel() {
	const capability = agentCapability();

	if (!capability.enabled) throw new AgentDisabledError(capability.reason);

	const zai = createOpenAICompatible({
		name: "zai",
		baseURL: capability.baseUrl,
		apiKey: env().zaiApiKey,
		fetch: limitedFetch,
	});

	return zai.chatModel(capability.model);
}
