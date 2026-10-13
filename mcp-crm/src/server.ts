import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { describeNetworkError, type CrmClient } from "./client.js";
import { APP, SERVER_IDENTITY } from "./config.js";
import {
  buildImportChatError,
  buildImportChatResult,
  buildIntakeStatusResult,
  importChatInput,
  intakeStatusInput,
} from "./tools.js";
import { TEXT } from "./user-text.js";

function jsonResult<Payload>(payload: Payload): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export type ServerContext = {
  client: CrmClient;
  baseUrl: string;
  maxTextLength: number;
  onWarning?: (message: string) => void;
};

export function createMcpServer(context: ServerContext): McpServer {
  const server = new McpServer(SERVER_IDENTITY, { capabilities: { tools: {} } });
  const onWarning = context.onWarning ?? (() => {});

  server.registerTool(
    "import_wechat_chat",
    {
      title: "导入聊天记录到 CRM",
      description: [
        TEXT.toolImportChat,
        TEXT.batchHint(context.maxTextLength),
      ].join(" "),
      inputSchema: importChatInput.shape,
    },
    async (args) => {
      const person = args.person.trim();
      const file = args.file?.trim() || null;
      const text = args.text;

      if (text.length > context.maxTextLength) {
        return jsonResult(
          buildImportChatError({
            person,
            file,
            text,
            message: `记录过长（${text.length} 字符，上限 ${context.maxTextLength}）。请按时间顺序拆成多批，依次调用本工具。`,
          }),
        );
      }

      try {
        const response = await context.client.importChat({ person, file, text });
        return jsonResult(buildImportChatResult({ person, file, text, response }));
      } catch (error) {
        onWarning(`转发失败：${describeNetworkError(error)}`);
        return jsonResult(
          buildImportChatError({ person, file, text, message: describeNetworkError(error) }),
        );
      }
    },
  );

  server.registerTool(
    "intake_status",
    {
      title: "查看 CRM 平台状态",
      description: TEXT.toolIntakeStatus,
      inputSchema: intakeStatusInput.shape,
    },
    async () => {
      const status = await context.client.status();
      return jsonResult(buildIntakeStatusResult({ baseUrl: context.baseUrl, status }));
    },
  );

  return server;
}

export async function connectStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}

export type HttpServerHandle = {
  origin: string;
  close: () => Promise<void>;
};

function writeText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

async function handleHttpRequest(
  context: ServerContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const path = new URL(request.url ?? "/", `http://${APP.http.host}`).pathname;
  if (path !== APP.http.path) {
    writeText(response, 404, TEXT.httpNotFound);
    return;
  }
  if (request.method !== "POST") {
    writeText(response, 405, TEXT.httpMethodNotAllowed);
    return;
  }

  const server = createMcpServer(context);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response);
}

export async function startHttpServer(
  context: ServerContext,
  port: number,
): Promise<HttpServerHandle> {
  const httpServer = createHttpServer((request, response) => {
    handleHttpRequest(context, request, response).catch(() => {
      if (!response.headersSent) writeText(response, 500, TEXT.unknownError);
      else response.end();
    });
  });

  await new Promise<void>((resolveListening, rejectListening) => {
    const onListenError = (error: Error): void => rejectListening(error);
    httpServer.once("error", onListenError);
    httpServer.listen(port, APP.http.host, () => {
      httpServer.off("error", onListenError);
      resolveListening();
    });
  });

  const address = httpServer.address();
  const boundPort = address !== null && typeof address === "object" ? address.port : port;

  return {
    origin: `http://${APP.http.host}:${boundPort}${APP.http.path}`,
    close: () => new Promise<void>((resolveClosed) => httpServer.close(() => resolveClosed())),
  };
}
