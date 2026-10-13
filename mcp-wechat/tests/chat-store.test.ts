import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChatStore } from "../src/chat-store.js";
import { fixturesDir, tmpDir } from "./helpers.js";

const workingDir = join(tmpDir, "store");
const emptyDir = join(tmpDir, "empty");

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  cpSync(fixturesDir, workingDir, { recursive: true });
  mkdirSync(emptyDir, { recursive: true });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ChatStore 索引", () => {
  test("列出会话：昵称、来源文件、条数、时间范围", async () => {
    const store = new ChatStore(fixturesDir);
    await store.refresh({ force: true });
    const chats = store.listChats();

    expect(chats.map((chat) => chat.person)).toEqual(["张三", "李四", "空文件", "记录"]);
    expect(chats[0]).toEqual({
      person: "张三",
      file: "与张三的聊天记录.txt",
      messages: 4,
      firstAt: "2024-05-01 09:12:03",
      lastAt: "2024-05-02 11:00:05",
    });
    expect(chats[1]).toEqual({
      person: "李四",
      file: "李四.txt",
      messages: 3,
      firstAt: "2024-06-01 08:00:00",
      lastAt: "2024-06-01 08:06:00",
    });
    expect(chats[2]).toEqual({
      person: "空文件",
      file: "空文件.txt",
      messages: 0,
      firstAt: null,
      lastAt: null,
    });
    expect(chats[3]).toEqual({
      person: "记录",
      file: "记录.txt",
      messages: 3,
      firstAt: "2024-07-01 10:00:00",
      lastAt: "2024-07-01 10:02:00",
    });
    expect(store.skippedLines).toBe(1);
  });

  test("非 txt 文件被忽略", async () => {
    const store = new ChatStore(fixturesDir);
    await store.refresh({ force: true });
    expect(store.people()).not.toContain("备注");
  });

  test("检索：无关键词返回全部，子串关键词过滤", async () => {
    const store = new ChatStore(fixturesDir);
    await store.refresh({ force: true });

    const all = await store.searchMessages("张三", undefined);
    expect(all.length).toBe(4);
    expect(all[0]).toEqual({
      person: "张三",
      direction: "in",
      sender: "张三",
      text: "你好，项目进展如何？\n第二行也属于同一条消息",
      at: "2024-05-01 09:12:03",
    });

    const hit = await store.searchMessages("张三", "报价");
    expect(hit.map((message) => message.text)).toEqual([
      "已经发了报价单",
      "报价单里含税吗？",
    ]);
    expect(hit.map((message) => message.direction)).toEqual(["out", "out"]);
  });

  test("检索是纯子串，不做模糊或拼音匹配", async () => {
    const store = new ChatStore(fixturesDir);
    await store.refresh({ force: true });
    expect((await store.searchMessages("张三", "报价dan")).length).toBe(0);
    expect((await store.searchMessages("张三", "bào jià")).length).toBe(0);
    expect((await store.searchMessages("张三", "张三")).length).toBe(0);
  });

  test("昵称不存在时返回空结果而不是报错", async () => {
    const store = new ChatStore(fixturesDir);
    await store.refresh({ force: true });
    expect(await store.searchMessages("不存在的人", undefined)).toEqual([]);
    expect(await store.recentMessages("不存在的人", 5)).toEqual([]);
    expect(store.people()).toEqual(["张三", "李四", "空文件", "记录"]);
  });

  test("最近消息返回尾部 limit 条并按时间升序", async () => {
    const store = new ChatStore(fixturesDir);
    await store.refresh({ force: true });
    const recent = await store.recentMessages("张三", 2);
    expect(recent.map((message) => message.at)).toEqual([
      "2024-05-02 10:30:00",
      "2024-05-02 11:00:05",
    ]);
    expect(recent.map((message) => message.text)).toEqual(["收到，我看看", "报价单里含税吗？"]);

    const all = await store.recentMessages("张三", 99);
    expect(all.length).toBe(4);
  });

  test("空目录得到零个会话且三个查询都返回空", async () => {
    const store = new ChatStore(emptyDir);
    await store.refresh({ force: true });
    expect(store.listChats()).toEqual([]);
    expect(store.people()).toEqual([]);
    expect(await store.searchMessages("任何人", undefined)).toEqual([]);
    expect(await store.recentMessages("任何人", 10)).toEqual([]);
  });

  test("文件变化后索引重建", async () => {
    const store = new ChatStore(workingDir);
    await store.refresh({ force: true });
    expect(store.listChats().find((chat) => chat.person === "李四")?.messages).toBe(3);

    const target = join(workingDir, "李四.txt");
    const original = readFileSync(target, "utf8");
    writeFileSync(target, `${original}2024-06-02 09:00:00 我\n补充一条消息\n`, "utf8");

    await store.refresh({ force: true });
    const updated = store.listChats().find((chat) => chat.person === "李四");
    expect(updated?.messages).toBe(4);
    expect(updated?.lastAt).toBe("2024-06-02 09:00:00");

    writeFileSync(target, original, "utf8");
    await store.refresh({ force: true });
    expect(store.listChats().find((chat) => chat.person === "李四")?.messages).toBe(3);
  });

  test("索引节流：未到间隔且未强制时不重扫", async () => {
    const store = new ChatStore(workingDir);
    await store.refresh({ force: true });
    const target = join(workingDir, "记录.txt");
    const original = readFileSync(target, "utf8");
    writeFileSync(target, `${original}2024-07-02 10:00:00 我\n节流测试\n`, "utf8");

    await store.refresh();
    expect(store.listChats().find((chat) => chat.person === "记录")?.messages).toBe(3);

    await store.refresh({ force: true });
    expect(store.listChats().find((chat) => chat.person === "记录")?.messages).toBe(4);

    writeFileSync(target, original, "utf8");
    await store.refresh({ force: true });
  });

  test("文件删除后会话消失", async () => {
    const target = join(workingDir, "记录.txt");
    const backup = readFileSync(target);
    rmSync(target);
    const store = new ChatStore(workingDir);
    await store.refresh({ force: true });
    expect(store.people()).not.toContain("记录");
    writeFileSync(target, backup);
  });
});
