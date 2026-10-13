import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export const packageDir = join(import.meta.dir, "..");
export const distEntry = join(packageDir, "dist", "index.js");
export const fixturesDir = join(import.meta.dir, "fixtures");
export const tmpDir = join(import.meta.dir, ".tmp");

export type SpawnOutcome = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  delete env.WECHAT_EXPORT_DIR;
  delete env.MCP_HTTP_PORT;
  return { ...env, ...extra };
}

export async function runNodeScript(
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<SpawnOutcome> {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  mkdirSync(tmpDir, { recursive: true });
  const stdoutPath = join(tmpDir, `spawn-${stamp}.out`);
  const stderrPath = join(tmpDir, `spawn-${stamp}.err`);
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");

  const child = spawn(process.execPath, args, {
    cwd: packageDir,
    env,
    stdio: ["ignore", stdoutFd, stderrFd],
  });

  const timedOut = await new Promise<boolean>((resolveFinished) => {
    const timer = setTimeout(() => {
      child.kill();
      resolveFinished(true);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolveFinished(false);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      resolveFinished(false);
    });
  });

  closeSync(stdoutFd);
  closeSync(stderrFd);
  const stdout = readFileSync(stdoutPath, "utf8");
  const stderr = readFileSync(stderrPath, "utf8");
  rmSync(stdoutPath, { force: true });
  rmSync(stderrPath, { force: true });

  return { code: child.exitCode, stdout, stderr, timedOut };
}
