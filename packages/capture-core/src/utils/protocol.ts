import { PROTOCOL_VERSION } from "../data.ts";

export function isProtocolVersionSupported(version: number): boolean {
  return version === PROTOCOL_VERSION;
}
