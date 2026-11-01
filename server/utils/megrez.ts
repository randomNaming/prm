import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import { getRequestHeader, type H3Event } from "h3";
import { env } from "./env";

/** 本站自己的会话 Cookie（里面放的是天权签发的 JWT，不做二次改写）。 */
export const SESSION_COOKIE = "prm_session";
/** 跳转前生成的一次性 state，回来时比对，防 CSRF。 */
export const STATE_COOKIE = "prm_sso_state";
/** 登录完成后要回到的站内路径。 */
export const NEXT_COOKIE = "prm_sso_next";

const JWKS_TTL_MS = 5 * 60 * 1000;

export type SessionClaims = {
	/** SSO 票据是 owner，设备票据是 dev_xxx */
	sub: string;
	exp: number;
	typ: "access";
};

type Jwk = {
	kid?: string;
	kty?: string;
	crv?: string;
	x?: string;
	alg?: string;
};

let cache: { fetchedAt: number; keys: Map<string, KeyObject> } = { fetchedAt: 0, keys: new Map() };

/** 四个变量齐全才启用鉴权；本地开发不填 = 与接入前行为完全一致。 */
export function megrezEnabled(): boolean {
	const current = env();

	return Boolean(
		current.megrezBase &&
			current.megrezClientId &&
			current.megrezClientSecret &&
			current.megrezRedirectUri,
	);
}

export function megrezConfig() {
	const current = env();

	return {
		base: current.megrezBase,
		clientId: current.megrezClientId,
		clientSecret: current.megrezClientSecret,
		redirectUri: current.megrezRedirectUri,
	};
}

/** 反代终止 TLS 时 node 看不到 https，只能靠 X-Forwarded-Proto 决定要不要加 Secure。 */
export function cookieOptions(event: H3Event, maxAge: number) {
	const proto = getRequestHeader(event, "x-forwarded-proto") ?? "";
	const secure = proto.split(",")[0]?.trim() === "https";

	return { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge, secure };
}

async function loadKeys(): Promise<Map<string, KeyObject>> {
	if (cache.keys.size > 0 && Date.now() - cache.fetchedAt < JWKS_TTL_MS) return cache.keys;

	const response = await fetch(`${megrezConfig().base}/api/.well-known/keys`);
	if (!response.ok) throw new Error(`天权公钥接口返回 ${response.status}`);

	const body = (await response.json()) as { keys?: Jwk[] };
	const keys = new Map<string, KeyObject>();

	for (const jwk of body.keys ?? []) {
		if (!jwk.kid || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) continue;
		keys.set(jwk.kid, createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }));
	}

	if (keys.size === 0) throw new Error("天权公钥为空或格式不符");

	cache = { fetchedAt: Date.now(), keys };

	return keys;
}

/** 本地验签：只认 EdDSA、只认 typ=access、只认未过期。任何异常都当作未登录。 */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	try {
		const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
			alg?: string;
			kid?: string;
		};
		if (header.alg !== "EdDSA" || !header.kid) return null;

		const key = (await loadKeys()).get(header.kid);
		if (!key) return null;

		const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
		if (!verifySignature(null, signed, key, Buffer.from(parts[2], "base64url"))) return null;

		const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
			sub?: string;
			exp?: number;
			typ?: string;
		};

		if (claims.typ !== "access") return null;
		if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) return null;
		if (!claims.sub) return null;

		return { sub: claims.sub, exp: claims.exp, typ: "access" };
	} catch {
		return null;
	}
}

function readCookie(event: H3Event, name: string): string {
	const raw = event.node.req.headers.cookie ?? "";

	for (const part of raw.split(";")) {
		const index = part.indexOf("=");
		if (index < 0) continue;
		if (part.slice(0, index).trim() !== name) continue;
		return decodeURIComponent(part.slice(index + 1).trim());
	}

	return "";
}

/** 从 Cookie 或 Authorization: Bearer 里取票，两条路都只做本地验签。 */
export async function readSession(event: H3Event): Promise<SessionClaims | null> {
	const cookie = readCookie(event, SESSION_COOKIE);
	const bearer = (getRequestHeader(event, "authorization") ?? "").replace(/^Bearer\s+/, "");
	const token = cookie || bearer;

	return token ? verifySessionToken(token) : null;
}
