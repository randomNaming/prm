#!/usr/bin/env node
import { createCrmClient } from "./client.js";
import { APP, loadEnv } from "./config.js";
import { connectStdio, createMcpServer, startHttpServer, type ServerContext } from "./server.js";
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

  for (const warning of envResult.env.warnings) writeStderr(warning);

  const client = createCrmClient({
    baseUrl: envResult.env.baseUrl,
    intakeUrl: envResult.env.intakeUrl,
    statusUrl: `${envResult.env.baseUrl}/api/status`,
  });

  const context: ServerContext = {
    client,
    baseUrl: envResult.env.baseUrl,
    maxTextLength: envResult.env.maxTextLength,
    onWarning: writeStderr,
  };

  writeStderr(TEXT.ready(envResult.env.baseUrl));

  if (envResult.env.httpPort !== null) {
    const handle = await startHttpServer(context, envResult.env.httpPort);
    writeStderr(TEXT.httpMode(APP.http.host, envResult.env.httpPort, APP.http.path));
    const shutdown = (): void => {
      void handle.close().then(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  writeStderr(TEXT.stdioMode);
  await connectStdio(createMcpServer(context));
}

main().catch((error: unknown) => {
  writeStderr(TEXT.fatalStartup(describeFailure(error)));
  process.exitCode = 1;
});
