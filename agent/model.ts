import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { agentCapability, env } from "../server/utils/env";

export class AgentDisabledError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "AgentDisabledError";
	}
}

export function agentModel() {
	const capability = agentCapability();

	if (!capability.enabled) throw new AgentDisabledError(capability.reason);

	const zai = createOpenAICompatible({
		name: "zai",
		baseURL: capability.baseUrl,
		apiKey: env().zaiApiKey,
	});

	return zai.chatModel(capability.model);
}
