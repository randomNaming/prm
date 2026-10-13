import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { ChatStore } from "../dist/chat-store.js";
import { createMcpServer } from "../dist/server.js";
import {
  chatSummarySchema,
  getRecentResultSchema,
  searchMessagesResultSchema,
} from "../src/domain.js";
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

async function connectClient(): Promise<Client> {
  const store = new ChatStore(fixturesDir);
  await store.refresh({ force: true });
  const server = createMcpServer(store);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "e2e-in-memory", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("内置客户端端到端：三个工具", () => {
  test("tools/list 只暴露三个工具", async () => {
    const client = await connectClient();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "get_recent",
      "list_chats",
      "search_messages",
    ]);
    await client.close();
  });

  test("list_chats 返回纯数据 JSON", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "list_chats", arguments: {} });
    const payload = z.array(chatSummarySchema).parse(JSON.parse(readTextPayload(result)));
    expect(payload.length).toBe(4);
    expect(payload[0]).toEqual({
      person: "张三",
      file: "与张三的聊天记录.txt",
      messages: 4,
      firstAt: "2024-05-01 09:12:03",
      lastAt: "2024-05-02 11:00:05",
    });
    await client.close();
  });

  test("search_messages 带关键词与不带关键词", async () => {
    const client = await connectClient();

    const filtered = searchMessagesResultSchema.parse(
      JSON.parse(
        readTextPayload(
          await client.callTool({
            name: "search_messages",
            arguments: { person: "张三", keyword: "报价" },
          }),
        ),
      ),
    );
    expect(filtered.person).toBe("张三");
    expect(filtered.keyword).toBe("报价");
    expect(filtered.count).toBe(2);
    expect(filtered.truncated).toBe(false);
    expect(filtered.availablePeople).toEqual(["张三", "李四", "空文件", "记录"]);
    expect(filtered.messages.map((message) => message.text)).toEqual([
      "已经发了报价单",
      "报价单里含税吗？",
    ]);

    const all = searchMessagesResultSchema.parse(
      JSON.parse(
        readTextPayload(
          await client.callTool({ name: "search_messages", arguments: { person: "李四" } }),
        ),
      ),
    );
    expect(all.keyword).toBeNull();
    expect(all.count).toBe(3);
    expect(all.messages[0].direction).toBe("in");
    expect(all.messages[1].direction).toBe("out");

    await client.close();
  });

  test("search_messages 昵称不存在时返回空数组加可用昵称", async () => {
    const client = await connectClient();
    const payload = searchMessagesResultSchema.parse(
      JSON.parse(
        readTextPayload(
          await client.callTool({ name: "search_messages", arguments: { person: "王五" } }),
        ),
      ),
    );
    expect(payload.messages).toEqual([]);
    expect(payload.count).toBe(0);
    expect(payload.availablePeople).toEqual(["张三", "李四", "空文件", "记录"]);
    await client.close();
  });

  test("get_recent 返回最近 limit 条", async () => {
    const client = await connectClient();
    const payload = getRecentResultSchema.parse(
      JSON.parse(
        readTextPayload(
          await client.callTool({ name: "get_recent", arguments: { person: "张三", limit: 2 } }),
        ),
      ),
    );
    expect(payload.limit).toBe(2);
    expect(payload.count).toBe(2);
    expect(payload.messages.map((message) => message.at)).toEqual([
      "2024-05-02 10:30:00",
      "2024-05-02 11:00:05",
    ]);

    const missing = getRecentResultSchema.parse(
      JSON.parse(
        readTextPayload(
          await client.callTool({ name: "get_recent", arguments: { person: "王五", limit: 2 } }),
        ),
      ),
    );
    expect(missing.messages).toEqual([]);
    expect(missing.availablePeople.length).toBe(4);

    await client.close();
  });

  test("get_recent 省略 limit 时使用默认值", async () => {
    const client = await connectClient();
    const payload = getRecentResultSchema.parse(
      JSON.parse(
        readTextPayload(
          await client.callTool({ name: "get_recent", arguments: { person: "张三" } }),
        ),
      ),
    );
    expect(payload.limit).toBe(20);
    expect(payload.count).toBe(4);
    await client.close();
  });

  test("非法入参被 Zod 拒绝", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "get_recent",
      arguments: { person: "张三", limit: 0 },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
