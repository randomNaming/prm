import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import { z } from "zod";
import { TEXT } from "./user-text.js";

export const APP = {
  /** CRM 平台上接收聊天记录的端点路径，固定，不接受覆盖。 */
  intakePath: "/api/intake",
  limits: {
    /** 单次转发原文的默认上限（字符）。 */
    defaultMaxTextLength: 50_000,
    /** 昵称上限，与平台侧 validate 保持一致。 */
    maxPersonChars: 64,
    /** 文件名上限，与平台侧 evidence.ref 上限一致。 */
    maxFileChars: 191,
  },
  http: {
    host: "127.0.0.1",
    path: "/mcp",
    minPort: 1,
    maxPort: 65_535,
  },
  fetch: {
    timeoutMs: 300_000,
  },
  fallbackIdentity: { name: "mcp-crm", version: "0.0.0" },
} as const;

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const envFilePath = resolve(packageRoot, ".env");

const packageJsonSchema = z.object({ name: z.string().min(1), version: z.string().min(1) });

function readIdentity(): { name: string; version: string } {
  try {
    const parsed = packageJsonSchema.safeParse(
      JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")),
    );
    if (parsed.success) return parsed.data;
  } catch {
    return { ...APP.fallbackIdentity };
  }
  return { ...APP.fallbackIdentity };
}

export const SERVER_IDENTITY = readIdentity();

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "必须是 http/https 地址");

const envSchema = z.object({
  CRM_BASE_URL: httpUrl,
  CRM_MAX_TEXT_LENGTH: z.coerce.number().int().positive(),
  MCP_HTTP_PORT: z.coerce.number().int().min(APP.http.minPort).max(APP.http.maxPort),
});

export type ResolvedEnv = {
  baseUrl: string;
  intakeUrl: string;
  maxTextLength: number;
  httpPort: number | null;
  warnings: string[];
};

export type EnvLoadResult = { ok: true; env: ResolvedEnv } | { ok: false; message: string };

export function loadEnv(): EnvLoadResult {
  loadDotenvFile({ path: envFilePath, quiet: true });

  const baseUrlResult = envSchema.shape.CRM_BASE_URL.safeParse(process.env.CRM_BASE_URL);
  if (!baseUrlResult.success) {
    const raw = process.env.CRM_BASE_URL;
    if (typeof raw === "string" && raw.trim().length > 0) {
      return { ok: false, message: TEXT.invalidBaseUrl(raw) };
    }
    return { ok: false, message: TEXT.missingBaseUrl(envFilePath) };
  }

  const warnings: string[] = [];

  const rawMaxText = process.env.CRM_MAX_TEXT_LENGTH;
  const maxTextResult = envSchema.shape.CRM_MAX_TEXT_LENGTH.safeParse(rawMaxText);
  const hasMaxText = typeof rawMaxText === "string" && rawMaxText.trim().length > 0;
  if (hasMaxText && !maxTextResult.success) {
    return { ok: false, message: TEXT.invalidMaxTextLength(String(rawMaxText)) };
  }

  const rawPort = process.env.MCP_HTTP_PORT;
  const portResult = envSchema.shape.MCP_HTTP_PORT.safeParse(rawPort);
  const hasPortValue = typeof rawPort === "string" && rawPort.trim().length > 0;
  if (hasPortValue && !portResult.success) {
    warnings.push(TEXT.invalidHttpPort(String(rawPort)));
  }

  const baseUrl = baseUrlResult.data.replace(/\/+$/, "");

  return {
    ok: true,
    env: {
      baseUrl,
      intakeUrl: `${baseUrl}${APP.intakePath}`,
      maxTextLength:
        hasMaxText && maxTextResult.success
          ? maxTextResult.data
          : APP.limits.defaultMaxTextLength,
      httpPort: hasPortValue && portResult.success ? portResult.data : null,
      warnings,
    },
  };
}
