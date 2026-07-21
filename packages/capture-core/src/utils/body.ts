import type { BodyCapture } from "../types.ts";

const MAX_BODY_CHARS = 20_000;

const CAPTURABLE_CONTENT_TYPE_RE = /^(text\/|application\/(json|.*\+json|xml|x-www-form-urlencoded|graphql))/i;

export function isCapturableContentType(mimeType: string | undefined): boolean {
  if (!mimeType) return true;
  return CAPTURABLE_CONTENT_TYPE_RE.test(mimeType);
}

export function capBody(text: string): { body: string; truncated: boolean } {
  if (text.length <= MAX_BODY_CHARS) return { body: text, truncated: false };
  return { body: text.slice(0, MAX_BODY_CHARS), truncated: true };
}

export function captureRequestBodyValue(raw: unknown): BodyCapture {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "string") return capBody(raw);
  if (raw instanceof URLSearchParams) return capBody(raw.toString());
  if (raw instanceof FormData) return { omittedReason: "FormData bodies aren't captured (may contain files)" };
  if (raw instanceof Blob) return { omittedReason: "Blob/File request bodies aren't captured" };
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw as ArrayBufferView)) return { omittedReason: "binary request body" };
  return { omittedReason: "unsupported request body type" };
}

export async function readBodyText(source: { clone: () => { text: () => Promise<string> } }, contentType: string | undefined): Promise<BodyCapture> {
  if (!isCapturableContentType(contentType)) return { omittedReason: "non-text content-type" };
  try {
    const text = await source.clone().text();
    return capBody(text);
  } catch {
    return { omittedReason: "failed to read body" };
  }
}
