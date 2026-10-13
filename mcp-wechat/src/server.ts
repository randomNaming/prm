import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ChatStore } from "./chat-store.js";
import { APP, SERVER_IDENTITY } from "./config.js";
import {
  buildGetRecentResult,
  buildSearchMessagesResult,
  getRecentInput,
  listChatsInput,
  resolveRecentLimit,
  searchMessagesInput,
} from "./tools.js";
import { TEXT } from "./user-text.js";

function jsonResult<Payload>(payload: Payload): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export function createMcpServer(store: ChatStore): McpServer {
  const server = new McpServer(SERVER_IDENTITY, { capabilities: { tools: {} } });

  server.registerTool(
    "list_chats",
    {
      title: "列出所有会话",
      description: TEXT.toolListChats,
      inputSchema: listChatsInput.shape,
    },
    async () => jsonResult(store.listChats()),
  );

  server.registerTool(
    "search_messages",
    {
      title: "检索会话消息",
      description: TEXT.toolSearchMessages,
      inputSchema: searchMessagesInput.shape,
    },
    async (args) => {
      const messages = await store.searchMessages(args.person, args.keyword);
      return jsonResult(
        buildSearchMessagesResult({
          person: args.person,
          keyword: args.keyword,
          messages,
          availablePeople: store.people(),
        }),
      );
    },
  );

  server.registerTool(
    "get_recent",
    {
      title: "读取最近消息",
      description: TEXT.toolGetRecent,
      inputSchema: getRecentInput.shape,
    },
    async (args) => {
      const limit = resolveRecentLimit(args.limit);
      const messages = await store.recentMessages(args.person, limit);
      return jsonResult(
        buildGetRecentResult({
          person: args.person,
          limit,
          messages,
          availablePeople: store.people(),
        }),
      );
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
  store: ChatStore,
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

  const server = createMcpServer(store);
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

export async function startHttpServer(store: ChatStore, port: number): Promise<HttpServerHandle> {
  const httpServer = createHttpServer((request, response) => {
    handleHttpRequest(store, request, response).catch(() => {
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
