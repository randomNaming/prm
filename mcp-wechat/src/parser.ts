import { z } from "zod";
import { APP } from "./config.js";
import { directionFromSender, messageHeaderSchema, type Direction } from "./domain.js";
import { peerFromDeclaredText } from "./peer-name.js";

const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

const headerPattern = /^\[?(\d{4})[-/](\d{2})[-/](\d{2}) (\d{2}):(\d{2}):(\d{2})\]?[ \t]*(.*)$/;
const senderSeparatorPattern = /[:：]/;

const timestampPartsSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2999),
  month: z.coerce.number().int().min(1).max(12),
  day: z.coerce.number().int().min(1).max(31),
  hour: z.coerce.number().int().min(0).max(23),
  minute: z.coerce.number().int().min(0).max(59),
  second: z.coerce.number().int().min(0).max(59),
});

const headerLineSchema = z.object({
  sender: z.string().trim().min(1).max(APP.limits.maxSenderChars),
  inlineText: z.string().nullable(),
});

export type ScannedMessage = {
  at: string;
  sender: string;
  direction: Direction;
  bodyStart: number;
  bodyEnd: number;
};

export type ScannedFile = {
  messages: ScannedMessage[];
  senders: string[];
  skippedLines: number;
  declaredPeer: string | null;
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function isRealCalendarDay(parts: z.infer<typeof timestampPartsSchema>): boolean {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day
  );
}

function formatTimestamp(parts: z.infer<typeof timestampPartsSchema>): string {
  return [
    `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`,
    `${pad(parts.hour, 2)}:${pad(parts.minute, 2)}:${pad(parts.second, 2)}`,
  ].join(" ");
}

type ParsedHeaderLine = {
  at: string;
  sender: string;
  direction: Direction;
  bodyStart: number;
};

function parseHeaderLine(
  line: string,
  content: Buffer,
  lineStart: number,
  nextLineStart: number,
): ParsedHeaderLine | null {
  if (Buffer.byteLength(line, "utf8") > APP.limits.maxHeaderBytes) return null;

  const match = headerPattern.exec(line);
  if (!match) return null;

  const parts = timestampPartsSchema.safeParse({
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4],
    minute: match[5],
    second: match[6],
  });
  if (!parts.success) return null;
  if (!isRealCalendarDay(parts.data)) return null;

  const at = formatTimestamp(parts.data);
  const remainder = match[7] ?? "";
  const remainderStart = line.length - remainder.length;
  const separator = senderSeparatorPattern.exec(remainder);

  const senderText = separator ? remainder.slice(0, separator.index) : remainder;
  const parsedHeader = headerLineSchema.safeParse({
    sender: senderText,
    inlineText: separator ? remainder.slice(separator.index + 1) : null,
  });
  if (!parsedHeader.success) return null;

  const header = messageHeaderSchema.safeParse({ at, sender: parsedHeader.data.sender });
  if (!header.success) return null;

  const remainderStartBytes = lineStart + Buffer.byteLength(line.slice(0, remainderStart), "utf8");
  const bodyStart =
    parsedHeader.data.inlineText === null
      ? nextLineStart
      : remainderStartBytes +
        Buffer.byteLength(remainder.slice(0, (separator?.index ?? 0) + 1), "utf8");

  const clampedBodyStart = Math.min(bodyStart, content.length);

  return {
    at: header.data.at,
    sender: header.data.sender,
    direction: directionFromSender(header.data.sender),
    bodyStart: clampedBodyStart,
  };
}

export function scanExport(content: Buffer): ScannedFile {
  const messages: ScannedMessage[] = [];
  const senders = new Set<string>();
  let skippedLines = 0;
  let declaredPeer: string | null = null;
  let cursor = 0;

  while (cursor < content.length) {
    const lineFeedIndex = content.indexOf(LINE_FEED, cursor);
    const lineEnd = lineFeedIndex === -1 ? content.length : lineFeedIndex;
    const nextLineStart = lineFeedIndex === -1 ? content.length : lineFeedIndex + 1;
    const contentEnd =
      lineEnd > cursor && content[lineEnd - 1] === CARRIAGE_RETURN ? lineEnd - 1 : lineEnd;
    const line = content.subarray(cursor, contentEnd).toString("utf8");

    const header = parseHeaderLine(line, content, cursor, nextLineStart);
    if (header) {
      const previous = messages.at(-1);
      if (previous) previous.bodyEnd = cursor;
      messages.push({ ...header, bodyEnd: content.length });
      senders.add(header.sender);
    } else if (messages.length === 0) {
      const trimmedLine = line.trim();
      if (trimmedLine.length > 0) {
        const declared = peerFromDeclaredText(trimmedLine);
        if (declared !== null && declaredPeer === null) {
          declaredPeer = declared;
        } else {
          skippedLines += 1;
        }
      }
    }

    cursor = nextLineStart;
  }

  return { messages, senders: [...senders], skippedLines, declaredPeer };
}

export function sliceBody(content: Buffer, bodyStart: number, bodyEnd: number): string {
  return content.subarray(bodyStart, bodyEnd).toString("utf8").trim();
}
