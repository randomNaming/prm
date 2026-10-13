#!/usr/bin/env node
import { ChatStore } from "./chat-store.js";
import { APP, checkExportDir, loadEnv } from "./config.js";
import { connectStdio, createMcpServer, startHttpServer } from "./server.js";
import { TEXT } from "./user-text.js";

function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : TEXT.unknownError;
}

async function main(): Promise<void> {
  const envResult = loadEnv();
  if (!envResult.ok) {
    writeStderr(envResult.message);
    process.exitCode = 1;
    return;
  }

  const dirCheck = checkExportDir(envResult.env.exportDir);
  if (!dirCheck.ok) {
    writeStderr(dirCheck.message);
    process.exitCode = 1;
    return;
  }

  for (const warning of envResult.env.warnings) writeStderr(warning);

  const store = new ChatStore(envResult.env.exportDir, writeStderr);
  await store.refresh({ force: true });
  writeStderr(TEXT.indexReady(store.listChats().length, store.skippedLines));

  if (envResult.env.httpPort !== null) {
    const handle = await startHttpServer(store, envResult.env.httpPort);
    writeStderr(TEXT.httpMode(APP.http.host, envResult.env.httpPort, APP.http.path));
    const shutdown = (): void => {
      void handle.close().then(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  writeStderr(TEXT.stdioMode);
  await connectStdio(createMcpServer(store));
}

main().catch((error: unknown) => {
  writeStderr(TEXT.fatalStartup(describeFailure(error)));
  process.exitCode = 1;
});
