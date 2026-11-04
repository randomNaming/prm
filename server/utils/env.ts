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
	/** 名片识图开关：显式 false 才停用；缺 key/模型名时 visionCapability() 会再拦。 */
	visionEnabled: boolean;
	visionBaseUrl: string;
	visionApiKey: string;
	visionModel: string;
	visionTimeoutMs: number;
	visionMaxImageBytes: number;
};

const DEFAULT_ZAI_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4";
const DEFAULT_ZAI_MODEL = "glm-5.2";
const DEFAULT_VISION_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_VISION_MODEL = "glm-5.3-flash";
const DEFAULT_VISION_TIMEOUT_MS = 45000;
const DEFAULT_VISION_MAX_IMAGE_BYTES = 4718592;

function positiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;

	const parsed = Number.parseInt(raw, 10);

	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
		visionEnabled: (process.env.VISION_ENABLED?.trim() || "true").toLowerCase() !== "false",
		visionBaseUrl: process.env.VISION_BASE_URL?.trim() || DEFAULT_VISION_BASE_URL,
		visionApiKey: process.env.VISION_API_KEY?.trim() ?? "",
		visionModel: process.env.VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
		visionTimeoutMs: positiveIntEnv("VISION_TIMEOUT_MS", DEFAULT_VISION_TIMEOUT_MS),
		visionMaxImageBytes: positiveIntEnv("VISION_MAX_IMAGE_BYTES", DEFAULT_VISION_MAX_IMAGE_BYTES),
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

/**
 * 名片识图能力：与 agentCapability() 完全独立，视觉挂了不影响聊天与研究。
 * 多模态可与 chat 共用同一个 key，只是配置字段不同（VISION_*）。
 */
export function visionCapability(): AgentCapability {
	const current = env();

	if (!current.visionEnabled) {
		return {
			enabled: false,
			model: current.visionModel,
			baseUrl: current.visionBaseUrl,
			reason: "VISION_ENABLED=false，名片识图已停用。",
		};
	}

	if (!current.visionApiKey) {
		return {
			enabled: false,
			model: current.visionModel,
			baseUrl: current.visionBaseUrl,
			reason: "未配置 VISION_API_KEY，名片识图已停用。",
		};
	}

	return {
		enabled: true,
		model: current.visionModel,
		baseUrl: current.visionBaseUrl,
		reason: "",
	};
}
