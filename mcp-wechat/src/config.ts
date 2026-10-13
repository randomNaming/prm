import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import { z } from "zod";
import { TEXT } from "./user-text.js";

const SECOND_MS = 1000;
const KIB = 1024;

export const APP = {
  index: { rebuildIntervalMs: 2 * SECOND_MS },
  limits: {
    defaultRecentLimit: 20,
    maxRecentLimit: 500,
    maxSearchResults: 5_000,
    maxHeaderBytes: 512,
    maxSenderChars: 64,
    maxFileBytes: 256 * KIB * KIB,
  },
  http: {
    host: "127.0.0.1",
    path: "/mcp",
    minPort: 1,
    maxPort: 65_535,
  },
  files: {
    extension: ".txt",
    genericStems: [
      "聊天记录",
      "微信",
      "微信聊天记录",
      "微信记录",
      "记录",
      "消息",
      "导出",
      "chat",
      "wechat",
      "export",
      "messages",
      "log",
    ],
  },
  senders: {
    self: ["我", "自己", "me", "我(自己)", "我（自己）"],
  },
  fallbackIdentity: { name: "mcp-wechat", version: "0.0.0" },
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

const envSchema = z.object({
  WECHAT_EXPORT_DIR: z.string().trim().min(1),
  MCP_HTTP_PORT: z.coerce
    .number()
    .int()
    .min(APP.http.minPort)
    .max(APP.http.maxPort),
});

export type ResolvedEnv = {
  exportDir: string;
  httpPort: number | null;
  warnings: string[];
};

export type EnvLoadResult = { ok: true; env: ResolvedEnv } | { ok: false; message: string };

export function loadEnv(): EnvLoadResult {
  loadDotenvFile({ path: envFilePath, quiet: true });

  const exportDirResult = envSchema.shape.WECHAT_EXPORT_DIR.safeParse(process.env.WECHAT_EXPORT_DIR);
  if (!exportDirResult.success) {
    return { ok: false, message: TEXT.missingExportDir(envFilePath) };
  }

  const warnings: string[] = [];
  const rawPort = process.env.MCP_HTTP_PORT;
  const portResult = envSchema.shape.MCP_HTTP_PORT.safeParse(rawPort);
  const hasPortValue = typeof rawPort === "string" && rawPort.trim().length > 0;
  if (hasPortValue && !portResult.success) {
    warnings.push(TEXT.invalidHttpPort(String(rawPort)));
  }

  return {
    ok: true,
    env: {
      exportDir: resolve(exportDirResult.data),
      httpPort: hasPortValue && portResult.success ? portResult.data : null,
      warnings,
    },
  };
}

export type DirCheckResult = { ok: true } | { ok: false; message: string };

const fsErrorSchema = z.object({ code: z.string().min(1) });

export function describeFsError(error: unknown): string {
  const parsed = fsErrorSchema.safeParse(error);
  if (parsed.success) return parsed.data.code;
  return error instanceof Error ? error.message : TEXT.unknownError;
}

export function checkExportDir(exportDir: string): DirCheckResult {
  let isDirectory = false;
  try {
    isDirectory = statSync(exportDir).isDirectory();
  } catch (error) {
    return { ok: false, message: TEXT.exportDirMissing(exportDir, describeFsError(error)) };
  }
  if (!isDirectory) {
    return { ok: false, message: TEXT.exportDirNotDirectory(exportDir) };
  }
  try {
    readdirSync(exportDir);
  } catch (error) {
    return { ok: false, message: TEXT.exportDirUnreadable(exportDir, describeFsError(error)) };
  }
  return { ok: true };
}
