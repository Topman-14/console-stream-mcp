import { redactHeaderValue } from "./redact.ts";
import type { RedactionOptions } from "../types.ts";

export function extractHeaders(source: HeadersInit | Headers | undefined, redaction: RedactionOptions): Record<string, string> | undefined {
  if (!source) return undefined;
  const headers = source instanceof Headers ? source : new Headers(source);
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    result[name] = redactHeaderValue(name, value, redaction);
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

export function findHeaderValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

export function parseXhrHeaders(raw: string, redaction: RedactionOptions): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name) result[name] = redactHeaderValue(name, value, redaction);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
