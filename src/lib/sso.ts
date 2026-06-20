import { createHash, randomBytes } from "node:crypto";

export const SSO_CODE_TTL_MS = 2 * 60 * 1000;

export function createSsoCode(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSsoCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
