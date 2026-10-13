import { extname } from "node:path";
import { z } from "zod";
import { APP } from "./config.js";
import { isSelfSender } from "./domain.js";

export const peerNameSchema = z.string().trim().min(1).max(APP.limits.maxSenderChars);

const declaredPeerPatterns = [/^与(.+?)的聊天记录$/, /^(.+?)的聊天记录$/, /^聊天对象\s*[:：]\s*(.+)$/];
const chatPrefixedPattern = /^chat[_-](.+?)(?:[_-]\d{4}.*)?$/i;
const trailingYearPattern = /^(.+?)[_-]\d{4}(?:[_-].*)?$/;
const allDigitsPattern = /^\d+$/;

function acceptedPeerName(candidate: string | undefined): string | null {
  if (candidate === undefined) return null;
  const parsed = peerNameSchema.safeParse(candidate);
  if (!parsed.success) return null;
  if (allDigitsPattern.test(parsed.data)) return null;
  return parsed.data;
}

export function baseName(fileName: string): string {
  const extension = extname(fileName);
  return extension.length > 0 ? fileName.slice(0, fileName.length - extension.length) : fileName;
}

export function peerFromDeclaredText(text: string): string | null {
  for (const pattern of declaredPeerPatterns) {
    const match = pattern.exec(text);
    if (match) {
      const name = acceptedPeerName(match[1]);
      if (name !== null && name !== text) return name;
    }
  }
  return null;
}

function isGenericStem(stem: string): boolean {
  const key = stem.trim().toLowerCase();
  return APP.files.genericStems.some((generic) => generic.toLowerCase() === key);
}

export function peerFromFileName(fileName: string): string | null {
  const stem = baseName(fileName).trim();

  const declared = peerFromDeclaredText(stem);
  if (declared !== null) return declared;

  const prefixed = chatPrefixedPattern.exec(stem);
  if (prefixed) {
    const name = acceptedPeerName(prefixed[1]);
    if (name !== null) return name;
  }

  if (isGenericStem(stem)) return null;

  const withYear = trailingYearPattern.exec(stem);
  if (withYear) {
    const stripped = acceptedPeerName(withYear[1]);
    if (stripped !== null && !isGenericStem(stripped)) return stripped;
  }

  return acceptedPeerName(stem);
}

export type PeerResolutionInput = {
  fileName: string;
  senders: readonly string[];
  declaredPeer: string | null;
};

export function resolvePeerName(input: PeerResolutionInput): string {
  if (input.declaredPeer !== null) return input.declaredPeer;

  const fromFileName = peerFromFileName(input.fileName);
  if (fromFileName !== null) return fromFileName;

  const others = input.senders.filter((sender) => !isSelfSender(sender));
  if (others.length === 1) return others[0];

  return baseName(input.fileName).trim();
}
