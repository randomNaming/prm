#!/usr/bin/env node
/**
 * 冒烟测试：以 stdio 启动 mcp-crm，握手后依次调用 intake_status 与 import_wechat_chat。
 * 需要先启动 stub-crm.mjs，并通过 CRM_BASE_URL 指向它。
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "dist", "index.js");
const baseUrl = process.env.CRM_BASE_URL ?? "http://127.0.0.1:3999";

const child = spawn(process.execPath, [entry], {
  env: { ...process.env, CRM_BASE_URL: baseUrl },
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  }
});

child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, params };
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`${method} 超时`));
    }, 20_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolveRequest(message);
    });
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function textOf(response) {
  const content = response?.result?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  try {
    return JSON.parse(content[0].text);
  } catch {
    return content[0].text;
  }
}

const sample = `翔铭达智能健康手表～许东明
2026年9月3日 15:16
【姓名】许东明
【籍贯】 广东茂名
【电话】19924544039
【爱好】运动
【公司名称】深圳市领健（翔铭达）科技有限公司
【主营产品】集研发、生产、销售于一体的国家高新技术与专精特新企业，主要产品包括：智能手表、心电图气泵式血压手表、4G健康监测手表、智能拍照AI眼镜等。
【地址】广东省深圳市宝安区黄麻布路普顺达科技楼C4栋A座7-8层。`;

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  console.log("[1] initialize ->", init.result?.serverInfo);

  notify("notifications/initialized", {});

  const tools = await request("tools/list", {});
  console.log(
    "[2] tools/list ->",
    (tools.result?.tools ?? []).map((tool) => tool.name).join(", "),
  );

  const status = await request("tools/call", { name: "intake_status", arguments: {} });
  console.log("[3] intake_status ->", JSON.stringify(textOf(status)));

  const imported = await request("tools/call", {
    name: "import_wechat_chat",
    arguments: { person: "许东明", file: "聊天记录.txt", text: sample },
  });
  console.log("[4] import_wechat_chat ->", JSON.stringify(textOf(imported), null, 2));

  const overLimit = await request("tools/call", {
    name: "import_wechat_chat",
    arguments: { person: "许东明", file: null, text: "x".repeat(50_001) },
  });
  console.log("[5] 超长拒绝 ->", JSON.stringify(textOf(overLimit)));
} catch (error) {
  console.error("冒烟失败：", error.message);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  setTimeout(() => child.kill(), 500);
}
