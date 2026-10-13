import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { directionFromSender } from "../src/domain.js";
import { scanExport, sliceBody } from "../src/parser.js";
import { peerFromDeclaredText, peerFromFileName, resolvePeerName } from "../src/peer-name.js";
import { fixturesDir } from "./helpers.js";

function scanFixture(fileName: string) {
  const content = readFileSync(join(fixturesDir, fileName));
  const scan = scanExport(content);
  return {
    content,
    scan,
    texts: scan.messages.map((message) => sliceBody(content, message.bodyStart, message.bodyEnd)),
  };
}

describe("scanExport 解析导出文件", () => {
  test("两个会话的 fixture 都能解析出正确条数与时间范围", () => {
    const zhang = scanFixture("与张三的聊天记录.txt");
    expect(zhang.scan.messages.length).toBe(4);
    expect(zhang.scan.messages.map((message) => message.at)).toEqual([
      "2024-05-01 09:12:03",
      "2024-05-01 09:15:20",
      "2024-05-02 10:30:00",
      "2024-05-02 11:00:05",
    ]);
    expect(zhang.scan.skippedLines).toBe(1);

    const li = scanFixture("李四.txt");
    expect(li.scan.messages.length).toBe(3);
    expect(li.scan.skippedLines).toBe(0);
    expect(li.texts).toEqual(["下周一有空吗？", "有空", "那下午两点见"]);
  });

  test("多行消息直到下一个时间行都属于同一条", () => {
    const zhang = scanFixture("与张三的聊天记录.txt");
    expect(zhang.texts[0]).toBe("你好，项目进展如何？\n第二行也属于同一条消息");
  });

  test("同一行写法 `时间 发送者: 正文` 与全角冒号都能解析", () => {
    const zhang = scanFixture("与张三的聊天记录.txt");
    expect(zhang.scan.messages[2].sender).toBe("张三");
    expect(zhang.texts[2]).toBe("收到，我看看");
    expect(zhang.scan.messages[3].sender).toBe("我");
    expect(zhang.texts[3]).toBe("报价单里含税吗？");
  });

  test("我 是发出方向，其他发送者是收到方向", () => {
    const zhang = scanFixture("与张三的聊天记录.txt");
    expect(zhang.scan.messages.map((message) => message.direction)).toEqual([
      "in",
      "out",
      "in",
      "out",
    ]);
  });

  test("所有本人写法都算发出方向", () => {
    for (const sender of ["我", "自己", "me", "Me", "我(自己)", "我（自己）", "ME"]) {
      expect(directionFromSender(sender)).toBe("out");
    }
    expect(directionFromSender("张三")).toBe("in");
    expect(directionFromSender("me 的同事")).toBe("in");
  });

  test("日期分隔符与方括号写法都被接受", () => {
    const content = Buffer.from(
      [
        "2024/01/02 03:04:05 甲",
        "斜杠日期",
        "[2024-01-02 03:04:06] 乙",
        "方括号日期",
        "[2024/01/02 03:04:07] 我：同行正文",
      ].join("\n"),
      "utf8",
    );
    const scan = scanExport(content);
    expect(scan.messages.length).toBe(3);
    expect(scan.messages.map((message) => message.at)).toEqual([
      "2024-01-02 03:04:05",
      "2024-01-02 03:04:06",
      "2024-01-02 03:04:07",
    ]);
    expect(sliceBody(content, scan.messages[2].bodyStart, scan.messages[2].bodyEnd)).toBe(
      "同行正文",
    );
  });

  test("空行与行尾空白被容忍", () => {
    const content = Buffer.from(
      ["", "   ", "2024-01-02 03:04:05 甲   ", "正文   ", "", "   ", ""].join("\n"),
      "utf8",
    );
    const scan = scanExport(content);
    expect(scan.messages.length).toBe(1);
    expect(scan.skippedLines).toBe(0);
    expect(sliceBody(content, scan.messages[0].bodyStart, scan.messages[0].bodyEnd)).toBe("正文");
  });

  test("CRLF 换行被容忍", () => {
    const content = Buffer.from("2024-01-02 03:04:05 甲\r\n第一行\r\n第二行\r\n", "utf8");
    const scan = scanExport(content);
    expect(scan.messages.length).toBe(1);
    expect(sliceBody(content, scan.messages[0].bodyStart, scan.messages[0].bodyEnd)).toBe(
      "第一行\r\n第二行",
    );
  });

  test("无法解析的行被跳过并计数，不抛错", () => {
    const content = Buffer.from(
      ["乱码行", "2024-13-45 03:04:05 甲", "2024-02-30 03:04:05 甲", "2024-01-02 03:04:05 甲", "正文"].join("\n"),
      "utf8",
    );
    const scan = scanExport(content);
    expect(scan.messages.length).toBe(1);
    expect(scan.skippedLines).toBe(3);
  });

  test("缺少发送者的时间行不是消息头", () => {
    const content = Buffer.from("2024-01-02 03:04:05\n正文\n", "utf8");
    const scan = scanExport(content);
    expect(scan.messages.length).toBe(0);
    expect(scan.skippedLines).toBe(2);
  });

  test("空文件得到零条消息且不抛错", () => {
    const content = readFileSync(join(fixturesDir, "空文件.txt"));
    const scan = scanExport(content);
    expect(content.length).toBe(0);
    expect(scan.messages.length).toBe(0);
    expect(scan.skippedLines).toBe(0);
    expect(scan.declaredPeer).toBeNull();
  });
});

describe("会话对象昵称解析", () => {
  test("文件名带昵称时优先取文件名", () => {
    expect(peerFromFileName("与张三的聊天记录.txt")).toBe("张三");
    expect(peerFromFileName("张三.txt")).toBe("张三");
    expect(peerFromFileName("chat_张三_2024.txt")).toBe("张三");
    expect(peerFromFileName("张三的聊天记录.txt")).toBe("张三");
    expect(peerFromFileName("张三_2024.txt")).toBe("张三");
  });

  test("文件名是通用词时不带昵称", () => {
    expect(peerFromFileName("记录.txt")).toBeNull();
    expect(peerFromFileName("聊天记录.txt")).toBeNull();
    expect(peerFromFileName("chat.txt")).toBeNull();
  });

  test("首行声明可以做昵称来源", () => {
    expect(peerFromDeclaredText("聊天对象：王五")).toBe("王五");
    expect(peerFromDeclaredText("与王五的聊天记录")).toBe("王五");
    expect(peerFromDeclaredText("随便一行")).toBeNull();
  });

  test("没有文件名昵称时用唯一的非本人发送者", () => {
    expect(
      resolvePeerName({ fileName: "记录.txt", senders: ["张三", "我"], declaredPeer: null }),
    ).toBe("张三");
  });

  test("多个非本人发送者时回退到文件名并保留每条发送者", () => {
    expect(
      resolvePeerName({ fileName: "记录.txt", senders: ["王五", "赵六", "我"], declaredPeer: null }),
    ).toBe("记录");
  });

  test("首行声明优先于文件名", () => {
    expect(
      resolvePeerName({ fileName: "记录.txt", senders: ["王五"], declaredPeer: "赵六" }),
    ).toBe("赵六");
  });
});
