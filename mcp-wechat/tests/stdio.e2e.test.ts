import { beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import {
  chatSummarySchema,
  getRecentResultSchema,
  searchMessagesResultSchema,
} from "../src/domain.js";
import { cleanEnv, distEntry, fixturesDir, packageDir } from "./helpers.js";

beforeAll(() => {
  if (!existsSync(distEntry)) {
    throw new Error("缺少 dist/index.js，请先运行 bun run build");
  }
});

function canSpawnWithPipes(): boolean {
  try {
    const probe = spawn(process.execPath, ["-e", ""], { stdio: ["pipe", "pipe", "pipe"] });
    probe.on("error", () => {});
    probe.kill();
    return true;
  } catch {
    return false;
  }
}

const pipesAvailable = canSpawnWithPipes();
if (!pipesAvailable) {
  process.stderr.write(
    [
      "",
      "跳过 stdio 子进程端到端测试：当前环境禁止创建管道，子进程 spawn 返回 EPERM。",
      "该限制来自运行沙箱，不来自本包代码。",
      "修复：在允许创建管道的普通终端中运行 bun test，本测试即会完整执行。",
      "",
    ].join("\n"),
  );
}

function readTextPayload(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("工具没有返回文本 JSON");
  }
  return first.text;
}

describe.skipIf(!pipesAvailable)("stdio 端到端：子进程 + 官方 StdioClientTransport", () => {
  test("启动构建产物，列出并调用三个工具", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: [distEntry],
      cwd: packageDir,
      env: cleanEnv({ WECHAT_EXPORT_DIR: fixturesDir }),
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e-stdio", version: "1.0.0" });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "get_recent",
      "list_chats",
      "search_messages",
    ]);

    const chats = z
      .array(chatSummarySchema)
      .parse(
        JSON.parse(
          readTextPayload(await client.callTool({ name: "list_chats", arguments: {} })),
        ),
      );
    expect(chats.map((chat) => chat.person)).toEqual(["张三", "李四", "空文件", "记录"]);
    expect(chats[0].messages).toBe(4);

    const searched = searchMessagesResultSchema.parse(
      JSON.parse(
        readTextPayload(
          await client.callTool({
            name: "search_messages",
            arguments: { person: "张三", keyword: "报价" },
          }),
        ),
      ),
    );
    expect(searched.count).toBe(2);
    expect(searched.messages.map((message) => message.direction)).toEqual(["out", "out"]);

    const recent = getRecentResultSchema.parse(
      JSON.parse(
        readTextPayload(
          await client.callTool({ name: "get_recent", arguments: { person: "李四", limit: 2 } }),
        ),
      ),
    );
    expect(recent.count).toBe(2);
    expect(recent.messages.map((message) => message.text)).toEqual(["有空", "那下午两点见"]);

    const missing = getRecentResultSchema.parse(
      JSON.parse(
        readTextPayload(
          await client.callTool({ name: "get_recent", arguments: { person: "没有这个人", limit: 2 } }),
        ),
      ),
    );
    expect(missing.messages).toEqual([]);
    expect(missing.availablePeople).toEqual(["张三", "李四", "空文件", "记录"]);

    await client.close();
  });
});
