// Simple HMAC-signed cookie session. No DB.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAppPassword } from "./creds";

const COOKIE = "pa_auth";

function secret() {
  // Derive a server-only signing key from APP_PASSWORD.
  return createHmac("sha256", "poker-arena-web").update(getAppPassword()).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function makeToken(): string {
  const payload = `v1.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  return verifyToken(c.get(COOKIE)?.value);
}

export async function setAuthCookie(token: string): Promise<void> {
  const c = await cookies();
  c.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export async function clearAuthCookie(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE);
}

export const AUTH_COOKIE_NAME = COOKIE;
