import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { APP, describeFsError } from "./config.js";
import {
  chatSummarySchema,
  type ChatSummary,
  type Direction,
  type WechatMessage,
  messageSchema,
} from "./domain.js";
import { scanExport, sliceBody } from "./parser.js";
import { resolvePeerName } from "./peer-name.js";
import { TEXT } from "./user-text.js";

export type IndexedMessage = {
  at: string;
  sender: string;
  direction: Direction;
  filePath: string;
  bodyStart: number;
  bodyEnd: number;
};

type FileScan = {
  filePath: string;
  fileName: string;
  person: string;
  messages: IndexedMessage[];
  skippedLines: number;
  mtimeMs: number;
  size: number;
};

export type ChatEntry = {
  person: string;
  fileLabel: string;
  messages: IndexedMessage[];
  skippedLines: number;
};

export type WarningSink = (message: string) => void;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareMessages(left: IndexedMessage, right: IndexedMessage): number {
  return (
    compareText(left.at, right.at) ||
    compareText(left.filePath, right.filePath) ||
    left.bodyStart - right.bodyStart
  );
}

async function readRange(filePath: string, start: number, end: number): Promise<Buffer> {
  const length = Math.max(end - start, 0);
  const buffer = Buffer.alloc(length);
  if (length === 0) return buffer;
  const handle = await open(filePath, "r");
  try {
    await handle.read(buffer, 0, length, start);
  } finally {
    await handle.close();
  }
  return buffer;
}

export class ChatStore {
  readonly exportDir: string;
  private readonly onWarning: WarningSink;
  private fileScans = new Map<string, FileScan>();
  private chats = new Map<string, ChatEntry>();
  private lastRefreshMs = 0;
  private lastSkippedLines = 0;

  constructor(exportDir: string, onWarning: WarningSink = () => {}) {
    this.exportDir = exportDir;
    this.onWarning = onWarning;
  }

  get skippedLines(): number {
    return this.lastSkippedLines;
  }

  async refresh(options: { force?: boolean } = {}): Promise<void> {
    const now = Date.now();
    if (options.force !== true && now - this.lastRefreshMs < APP.index.rebuildIntervalMs) return;
    this.lastRefreshMs = now;

    const entries = await readdir(this.exportDir, { withFileTypes: true });
    const txtFileNames = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(APP.files.extension))
      .map((entry) => entry.name)
      .sort(compareText);

    const present = new Set<string>();
    for (const fileName of txtFileNames) {
      const filePath = join(this.exportDir, fileName);
      present.add(filePath);
      await this.rescanFile(filePath, fileName);
    }

    for (const filePath of [...this.fileScans.keys()]) {
      if (!present.has(filePath)) this.fileScans.delete(filePath);
    }

    this.rebuildChats();
  }

  private async rescanFile(filePath: string, fileName: string): Promise<void> {
    try {
      const stats = await stat(filePath);
      if (stats.size > APP.limits.maxFileBytes) {
        this.onWarning(TEXT.fileTooLarge(fileName, APP.limits.maxFileBytes));
        this.fileScans.delete(filePath);
        return;
      }
      const known = this.fileScans.get(filePath);
      if (known && known.mtimeMs === stats.mtimeMs && known.size === stats.size) return;

      const content = await readFile(filePath);
      const scan = scanExport(content);
      const person = resolvePeerName({
        fileName,
        senders: scan.senders,
        declaredPeer: scan.declaredPeer,
      });
      this.fileScans.set(filePath, {
        filePath,
        fileName,
        person,
        messages: scan.messages.map((message) => ({ ...message, filePath })),
        skippedLines: scan.skippedLines,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      });
    } catch (error) {
      this.onWarning(TEXT.fileUnreadable(fileName, describeFsError(error)));
      this.fileScans.delete(filePath);
    }
  }

  private rebuildChats(): void {
    const grouped = new Map<string, FileScan[]>();
    for (const fileScan of this.fileScans.values()) {
      const bucket = grouped.get(fileScan.person);
      if (bucket) bucket.push(fileScan);
      else grouped.set(fileScan.person, [fileScan]);
    }

    const chats = new Map<string, ChatEntry>();
    let skippedLines = 0;
    for (const [person, scans] of grouped) {
      const ordered = [...scans].sort((left, right) => compareText(left.fileName, right.fileName));
      const messages = ordered.flatMap((fileScan) => fileScan.messages);
      messages.sort(compareMessages);
      const skipped = ordered.reduce((total, fileScan) => total + fileScan.skippedLines, 0);
      skippedLines += skipped;
      chats.set(person, {
        person,
        fileLabel: ordered.map((fileScan) => fileScan.fileName).join(", "),
        messages,
        skippedLines: skipped,
      });
    }

    this.chats = chats;
    this.lastSkippedLines = skippedLines;
  }

  people(): string[] {
    return [...this.chats.keys()].sort(compareText);
  }

  listChats(): ChatSummary[] {
    return [...this.chats.values()]
      .sort((left, right) => compareText(left.person, right.person))
      .map((chat) =>
        chatSummarySchema.parse({
          person: chat.person,
          file: chat.fileLabel,
          messages: chat.messages.length,
          firstAt: chat.messages.at(0)?.at ?? null,
          lastAt: chat.messages.at(-1)?.at ?? null,
        }),
      );
  }

  async searchMessages(person: string, keyword: string | undefined): Promise<WechatMessage[]> {
    await this.refresh();
    const chat = this.chats.get(person);
    if (!chat) return [];

    const needle = (keyword ?? "").trim().toLowerCase();
    const texts = await this.readBodies(chat.messages);
    const results: WechatMessage[] = [];
    for (const [index, message] of chat.messages.entries()) {
      const text = texts[index] ?? "";
      if (needle.length > 0 && !text.toLowerCase().includes(needle)) continue;
      results.push(this.toWechatMessage(chat.person, message, text));
      if (results.length >= APP.limits.maxSearchResults) break;
    }
    return results;
  }

  async recentMessages(person: string, limit: number): Promise<WechatMessage[]> {
    await this.refresh();
    const chat = this.chats.get(person);
    if (!chat) return [];

    const start = Math.max(chat.messages.length - limit, 0);
    const selected = chat.messages.slice(start);
    const texts = await this.readBodies(selected);
    return selected.map((message, index) =>
      this.toWechatMessage(chat.person, message, texts[index] ?? ""),
    );
  }

  private toWechatMessage(person: string, message: IndexedMessage, text: string): WechatMessage {
    return messageSchema.parse({
      person,
      direction: message.direction,
      sender: message.sender,
      text,
      at: message.at,
    });
  }

  private async readBodies(targets: IndexedMessage[]): Promise<string[]> {
    const ranges = new Map<string, { start: number; end: number }>();
    for (const target of targets) {
      const range = ranges.get(target.filePath);
      if (!range) {
        ranges.set(target.filePath, { start: target.bodyStart, end: target.bodyEnd });
        continue;
      }
      range.start = Math.min(range.start, target.bodyStart);
      range.end = Math.max(range.end, target.bodyEnd);
    }

    const sources = new Map<string, { start: number; data: Buffer }>();
    for (const [filePath, range] of ranges) {
      try {
        sources.set(filePath, { start: range.start, data: await readRange(filePath, range.start, range.end) });
      } catch (error) {
        this.onWarning(TEXT.fileUnreadable(filePath, describeFsError(error)));
      }
    }

    return targets.map((target) => {
      const source = sources.get(target.filePath);
      if (!source) return "";
      return sliceBody(
        source.data,
        target.bodyStart - source.start,
        target.bodyEnd - source.start,
      );
    });
  }
}
