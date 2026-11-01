import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

export type AppEnv = {
	databaseUrl: string;
	zaiApiKey: string;
	zaiBaseUrl: string;
	zaiModel: string;
	host: string;
	port: string;
	/** 天权（megrez）身份中心地址，例如 http://127.0.0.1:8787 */
	megrezBase: string;
	/** 在天权后台「接入项目」登记后拿到的 client_id */
	megrezClientId: string;
	/** 同上，client_secret 只放服务端环境变量 */
	megrezClientSecret: string;
	/** 必须与天权后台登记的回调地址完全一致 */
	megrezRedirectUri: string;
};

const DEFAULT_ZAI_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4";
const DEFAULT_ZAI_MODEL = "glm-5.2";

let envFileLoaded = false;

function ensureEnvFile(): void {
	if (envFileLoaded) return;

	envFileLoaded = true;
	loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });
}

export function env(): AppEnv {
	ensureEnvFile();

	return {
		databaseUrl: process.env.DATABASE_URL?.trim() ?? "",
		zaiApiKey: process.env.ZAI_API_KEY?.trim() ?? "",
		zaiBaseUrl: process.env.ZAI_BASE_URL?.trim() || DEFAULT_ZAI_BASE_URL,
		zaiModel: process.env.ZAI_MODEL?.trim() || DEFAULT_ZAI_MODEL,
		host: process.env.HOST?.trim() || "127.0.0.1",
		port: process.env.PORT?.trim() || "3000",
		megrezBase: (process.env.MEGREZ_BASE?.trim() || "").replace(/\/+$/, ""),
		megrezClientId: process.env.MEGREZ_CLIENT_ID?.trim() || "",
		megrezClientSecret: process.env.MEGREZ_CLIENT_SECRET?.trim() || "",
		megrezRedirectUri: process.env.MEGREZ_REDIRECT_URI?.trim() || "",
	};
}

export type AgentCapability = {
	enabled: boolean;
	model: string;
	baseUrl: string;
	reason: string;
};

export function agentCapability(): AgentCapability {
	const current = env();

	if (!current.zaiApiKey) {
		return {
			enabled: false,
			model: current.zaiModel,
			baseUrl: current.zaiBaseUrl,
			reason: "未配置 ZAI_API_KEY，智能体对话与后台研究已停用。",
		};
	}

	return {
		enabled: true,
		model: current.zaiModel,
		baseUrl: current.zaiBaseUrl,
		reason: "",
	};
}
