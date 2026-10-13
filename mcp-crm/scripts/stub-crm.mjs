#!/usr/bin/env node
/**
 * 假 CRM 平台，仅用于验证 mcp-crm 的转发链路。
 * 监听 /api/intake 与 /api/status，把收到的载荷原样回显。
 * 不连接数据库，不调用大模型。
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3999);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/api/status" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ agentEnabled: true, agentReason: "", model: "stub" }));
    return;
  }

  if (url.pathname === "/api/intake" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body || "{}");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          conversationId: "conv_stub_001",
          messageId: "msg_stub_001",
          summary: `已处理来自「${payload.person}」的记录，共 ${String(payload.text ?? "").length} 字符。`,
          counts: { ensure_contact: 1, ensure_company: 1, record_fact: 3, classify_role: 1, create_activity: 1 },
          created: {
            contacts: [{ id: "ct_stub_001", name: "许东明" }],
            companies: [{ id: "co_stub_001", name: "深圳市领健（翔铭达）科技有限公司" }],
          },
        }),
      );
    });
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("404");
});

server.listen(port, "127.0.0.1", () => {
  process.stderr.write(`stub CRM listening on http://127.0.0.1:${port}\n`);
});
