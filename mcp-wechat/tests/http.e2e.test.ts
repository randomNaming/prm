import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { ChatStore } from "../dist/chat-store.js";
import { startHttpServer } from "../dist/server.js";
import { chatSummarySchema } from "../src/domain.js";
import { distEntry, fixturesDir } from "./helpers.js";

beforeAll(() => {
  if (!existsSync(distEntry)) {
    throw new Error("缺少 dist/index.js，请先运行 bun run build");
  }
});

function readTextPayload(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("工具没有返回文本 JSON");
  }
  return first.text;
}

describe("Streamable HTTP 传输端到端", () => {
  test("HTTP 模式下客户端可以连接并调用工具", async () => {
    const store = new ChatStore(fixturesDir);
    await store.refresh({ force: true });
    const handle = await startHttpServer(store, 0);
    expect(handle.origin.startsWith("http://127.0.0.1:")).toBe(true);

    const client = new Client({ name: "e2e-http", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.origin)));

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

    await client.close();
    await handle.close();
  });

  test("非 MCP 路径返回 404，GET 返回 405", async () => {
    const store = new ChatStore(fixturesDir);
    await store.refresh({ force: true });
    const handle = await startHttpServer(store, 0);
    const base = handle.origin.slice(0, handle.origin.length - "/mcp".length);

    const notFound = await fetch(`${base}/other`);
    expect(notFound.status).toBe(404);

    const notAllowed = await fetch(handle.origin, { method: "GET" });
    expect(notAllowed.status).toBe(405);

    await handle.close();
  });
});
