import { defineSetting } from "./storage.js";

export interface CaptureOptions {
  console: boolean;
  network: boolean;
  errors: boolean;
  dom: boolean;
}

export interface PrivacyOptions {
  redactedHeaderNames: string[];
  maskEmails: boolean;
  maskJwts: boolean;
  redactSensitiveBodyFields: boolean;
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  console: true,
  network: true,
  errors: true,
  dom: true,
};

export const DEFAULT_REDACTED_HEADER_NAMES = ["authorization", "cookie", "set-cookie", "x-api-key"];

export const DEFAULT_PRIVACY_OPTIONS: PrivacyOptions = {
  redactedHeaderNames: DEFAULT_REDACTED_HEADER_NAMES,
  maskEmails: false,
  maskJwts: true,
  redactSensitiveBodyFields: true,
};

export const captureOptionsSetting = defineSetting("captureOptions", DEFAULT_CAPTURE_OPTIONS);
export const privacyOptionsSetting = defineSetting("privacyOptions", DEFAULT_PRIVACY_OPTIONS);
