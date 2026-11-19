import { createHash, randomBytes } from "node:crypto";

// Tokens de sesión, invitación y reseteo. Se entregan una sola vez; en base solo se guarda el hash.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
