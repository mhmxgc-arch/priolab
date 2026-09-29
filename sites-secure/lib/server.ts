import { env } from "cloudflare:workers";
import { sha256 } from "./security";

export type UserRow = { id: string; username: string; salt: string; password_hash: string; totp_secret: string; last_totp_step: number; role: "admin" | "editor" | "viewer"; status: "pending" | "active" | "disabled"; created_at: number };
export type SessionUser = Pick<UserRow, "id" | "username" | "role" | "status">;

export function database(): D1Database {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("Database is unavailable");
  return db;
}
export function encryptionKey(): string {
  const key = (env as unknown as { APP_ENCRYPTION_KEY?: string }).APP_ENCRYPTION_KEY;
  if (!key) throw new Error("Encryption key is unavailable");
  return key;
}
export function bootstrapToken(): string {
  const token = (env as unknown as { BOOTSTRAP_TOKEN?: string }).BOOTSTRAP_TOKEN;
  if (!token) throw new Error("Bootstrap token is unavailable");
  return token;
}
export function clientIp(request: Request): string | null {
  return request.headers.get("cf-connecting-ip")?.trim().toLowerCase() || null;
}
export function json(data: unknown, status = 200, cookie?: string): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return Response.json(data, { status, headers });
}
export function error(message: string, status = 400): Response { return json({ error: message }, status); }
export function sessionCookie(token: string, maxAge = 28800): string {
  return `priolab_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export async function ipAllowed(request: Request): Promise<boolean> {
  const setting = await database().prepare("SELECT value FROM settings WHERE key = ?").bind("ip_enforced").first<{ value: string }>();
  if (setting?.value !== "1") return true;
  const ip = clientIp(request);
  if (!ip) return false;
  const rule = await database().prepare("SELECT address FROM ip_allowlist WHERE address = ?").bind(ip).first();
  return !!rule;
}
export async function sessionUser(request: Request): Promise<SessionUser | null> {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)priolab_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  const hash = await sha256(token);
  return database().prepare("SELECT u.id, u.username, u.role, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'").bind(hash, Date.now()).first<SessionUser>();
}
export function validOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin && request.headers.get("content-type")?.startsWith("application/json") === true;
}
