import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cleanEnv, distEntry, fixturesDir, runNodeScript, tmpDir } from "./helpers.js";

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
  if (!existsSync(distEntry)) {
    throw new Error("缺少 dist/index.js，请先运行 bun run build");
  }
});

describe("启动行为", () => {
  test("未配置 WECHAT_EXPORT_DIR 时以非零码退出并打印中文原因", async () => {
    const outcome = await runNodeScript([distEntry], cleanEnv({}), 10_000);
    expect(outcome.timedOut).toBe(false);
    expect(outcome.code).not.toBe(0);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("未配置必需的环境变量 WECHAT_EXPORT_DIR");
    expect(outcome.stderr).toContain("修复：");
    expect(outcome.stderr).not.toContain("at ");
    expect(outcome.stdout).toBe("");
  });

  test("WECHAT_EXPORT_DIR 指向不存在的目录时以非零码退出", async () => {
    const outcome = await runNodeScript(
      [distEntry],
      cleanEnv({ WECHAT_EXPORT_DIR: join(tmpDir, "不存在的目录") }),
      10_000,
    );
    expect(outcome.timedOut).toBe(false);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("不存在或无法访问");
  });

  test("WECHAT_EXPORT_DIR 指向文件而不是目录时以非零码退出", async () => {
    const outcome = await runNodeScript(
      [distEntry],
      cleanEnv({ WECHAT_EXPORT_DIR: distEntry }),
      10_000,
    );
    expect(outcome.timedOut).toBe(false);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("指向的不是目录");
  });

  test("目录有效时建立索引并以 stdio 模式启动", async () => {
    const outcome = await runNodeScript(
      [distEntry],
      cleanEnv({ WECHAT_EXPORT_DIR: fixturesDir }),
      10_000,
    );
    expect(outcome.timedOut).toBe(false);
    expect(outcome.code).toBe(0);
    expect(outcome.stderr).toContain("索引已建立，共 4 个会话");
    expect(outcome.stderr).toContain("stdio 模式");
    expect(outcome.stdout).toBe("");
  });

  test("MCP_HTTP_PORT 非法时只警告并回退 stdio", async () => {
    const outcome = await runNodeScript(
      [distEntry],
      cleanEnv({ WECHAT_EXPORT_DIR: fixturesDir, MCP_HTTP_PORT: "不是端口" }),
      10_000,
    );
    expect(outcome.stderr).toContain("MCP_HTTP_PORT 的值无效");
    expect(outcome.stderr).toContain("stdio 模式");
  });

  test("空目录启动为 0 个会话", async () => {
    const emptyDir = join(tmpDir, "empty-startup");
    mkdirSync(emptyDir, { recursive: true });
    const outcome = await runNodeScript(
      [distEntry],
      cleanEnv({ WECHAT_EXPORT_DIR: emptyDir }),
      10_000,
    );
    expect(outcome.stderr).toContain("索引已建立，共 0 个会话");
  });
});
