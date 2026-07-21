import { ConsoleMethod, type ProtocolVersion, type RedactionOptions } from "./types.ts";

export const PROTOCOL_VERSION: ProtocolVersion = 1;

export const DEFAULT_REDACTION: RedactionOptions = {
  redactedHeaderNames: [],
  maskEmails: false,
  maskJwts: false,
  redactSensitiveBodyFields: false,
};

export const CONSOLE_METHODS = Object.values(ConsoleMethod);
