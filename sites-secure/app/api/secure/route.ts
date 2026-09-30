import { database, encryptionKey, clientIp, json, error, sessionCookie, sessionUser, ipAllowed, validOrigin, type UserRow } from "@/lib/server";
import { constantEqual, decryptTotp, encryptTotp, newTotpSecret, passwordHash, randomHex, sha256, totpUri, verifyTotp } from "@/lib/security";
import { APP_VERSION } from "@/lib/version";

export const runtime = "edge";
const now = () => Date.now();
const usernameOf = (value: unknown) => String(value ?? "").trim().toLowerCase();
const validUsername = (value: string) => /^[\p{L}\p{N}._-]{3,40}$/u.test(value);
const validPassword = (value: unknown) => typeof value === "string" && value.length >= 8 && value.length <= 128;
const strongPassword = (value: unknown) => validPassword(value) && /[A-Z]/.test(value as string) && /[a-z]/.test(value as string) && /[0-9]/.test(value as string) && /[^A-Za-z0-9\s]/.test(value as string);
const validIp = (value: string) => value.length <= 45 && (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) ? value.split(".").every(part => Number(part) <= 255) : /^[a-f0-9:]+$/.test(value) && value.includes(":"));
const secureHeaders = (request: Request) => request.headers.get("oai-authenticated-user-id");
async function attemptsKey(request: Request, username: string) { return sha256(`${clientIp(request) || "unknown"}|${username}`); }
async function locked(key: string): Promise<boolean> {
  const row = await database().prepare("SELECT failures, window_start FROM login_attempts WHERE key = ?").bind(key).first<{ failures: number; window_start: number }>();
  return !!row && row.failures >= 5 && now() - row.window_start < 15 * 60 * 1000;
}
async function failed(key: string) {
  const timestamp = now();
  await database().prepare("INSERT INTO login_attempts (key, failures, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET failures = CASE WHEN ? - window_start > 900000 THEN 1 ELSE failures + 1 END, window_start = CASE WHEN ? - window_start > 900000 THEN ? ELSE window_start END").bind(key, timestamp, timestamp, timestamp, timestamp).run();
}
async function clearAttempts(key: string) { await database().prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run(); }
async function getUser(username: string) { return database().prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>(); }
async function authenticatePassword(request: Request, username: string, password: unknown) {
  const key = await attemptsKey(request, username);
  if (await locked(key)) return { key, user: null, throttled: true };
  const user = await getUser(username);
  const hash = await passwordHash(typeof password === "string" ? password : "", user?.salt || "00".repeat(16));
  if (!user || user.status === "disabled" || !constantEqual(hash, user.password_hash)) { await failed(key); return { key, user: null, throttled: false }; }
  return { key, user, throttled: false };
}
async function createSession(userId: string) {
  const token = randomHex();
  await database().prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), userId, now() + 8 * 3600 * 1000, now()).run();
  return token;
}
function publicUser(user: { id: string; username: string; role: string; status: string }) { return { id: user.id, username: user.username, role: user.role, status: user.status }; }
function reportRow(row: Record<string, unknown>) { return { id: row.id, description: row.description, taxYear: String(row.tax_year), period: String(row.tax_year), from: row.created_by === "system-migration" ? null : row.from_month, to: row.created_by === "system-migration" ? null : row.to_month, filename: row.filename, rows: JSON.parse(String(row.rows_json)) }; }

export async function GET(request: Request) {
  try {
    if (!await ipAllowed(request)) return error("גישה מכתובת IP זו אינה מורשית", 403);
    const action = new URL(request.url).searchParams.get("action");
    if (action === "status") {
      const count = await database().prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
      const user = await sessionUser(request);
      const needsSetup = count?.total === 0;
      return json({ version: APP_VERSION, setup: needsSetup && !!secureHeaders(request), setupUnavailable: needsSetup && !secureHeaders(request), authenticated: !!user, user: user ? publicUser(user) : null });
    }
    const user = await sessionUser(request);
    if (!user) return error("נדרש אימות", 401);
    if (action === "reports") {
      const result = await database().prepare("SELECT * FROM reports ORDER BY tax_year DESC, to_month DESC, updated_at DESC").all<Record<string, unknown>>();
      return json({ reports: result.results.map(reportRow) });
    }
    if (action === "settings") {
      if (user.role !== "admin") return error("אין הרשאה", 403);
      const [users, rules, setting] = await Promise.all([
        database().prepare("SELECT id, username, role, status, created_at FROM users ORDER BY created_at").all(),
        database().prepare("SELECT address, created_at FROM ip_allowlist ORDER BY address").all(),
        database().prepare("SELECT value FROM settings WHERE key = ?").bind("ip_enforced").first<{ value: string }>(),
      ]);
      return json({ users: users.results, ipRules: rules.results, ipEnforced: setting?.value === "1", currentIp: clientIp(request) });
    }
    return error("פעולה לא מוכרת", 404);
  } catch (cause) { console.error("Secure API GET failed", cause); return error("הנתונים אינם זמינים כעת", 503); }
}

export async function POST(request: Request) {
  try {
    if (!validOrigin(request)) return error("בקשה לא מורשית", 403);
    if (Number(request.headers.get("content-length") || 0) > 2_000_000) return error("הקובץ גדול מדי", 413);
    if (!await ipAllowed(request)) return error("גישה מכתובת IP זו אינה מורשית", 403);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "bootstrap") {
      const count = await database().prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
      if (count?.total || !secureHeaders(request)) return error("הגדרת מנהל אינה זמינה", 403);
      const username = usernameOf(body.username);
      if (!validUsername(username) || !validPassword(body.password)) return error("נדרש שם משתמש תקין וסיסמה ראשונית בת 8 תווים לפחות");
      const salt = randomHex(16), secret = newTotpSecret(), id = crypto.randomUUID();
      await database().prepare("INSERT INTO users (id, username, salt, password_hash, totp_secret, last_totp_step, role, status, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, -1, 'admin', 'pending', 1, ?)").bind(id, username, salt, await passwordHash(String(body.password), salt), await encryptTotp(secret, encryptionKey()), now()).run();
      return json({ changeRequired: true }, 201);
    }
    if (action === "login" || action === "enroll" || action === "password.change") {
      const username = usernameOf(body.username);
      if (!validUsername(username)) return error("פרטי הכניסה שגויים", 401);
      const result = await authenticatePassword(request, username, body.password);
      if (result.throttled) return error("יותר מדי ניסיונות. נסה שוב בעוד 15 דקות", 429);
      if (!result.user) return error("פרטי הכניסה שגויים", 401);
      const user = result.user;
      if (action === "password.change") {
        if (user.must_change_password !== 1) return error("לא נדרשת החלפת סיסמה", 400);
        if (!strongPassword(body.newPassword) || constantEqual(String(body.password), String(body.newPassword))) return error("בחר סיסמה חדשה בת 8 תווים לפחות עם אות גדולה, אות קטנה, ספרה וסימן מיוחד, ושונה מהקודמת");
        const salt = randomHex(16);
        const changed = await database().prepare("UPDATE users SET salt = ?, password_hash = ?, must_change_password = 0 WHERE id = ? AND password_hash = ? AND must_change_password = 1").bind(salt, await passwordHash(String(body.newPassword), salt), user.id, user.password_hash).run();
        if (changed.meta.changes !== 1) return error("הסיסמה כבר הוחלפה. היכנס מחדש", 409);
        await database().prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
        await clearAttempts(result.key);
        const secret = await decryptTotp(user.totp_secret, encryptionKey());
        return json({ enroll: true, secret, uri: totpUri(username, secret) });
      }
      if (user.must_change_password === 1) return action === "login" ? json({ changeRequired: true }) : error("יש להחליף את הסיסמה הראשונית", 403);
      const secret = await decryptTotp(user.totp_secret, encryptionKey());
      if (user.status === "pending" && action === "login") return json({ enroll: true, secret, uri: totpUri(username, secret) });
      if ((user.status === "pending") !== (action === "enroll")) return error("שלב האימות אינו תקין", 400);
      if (action === "login" && !body.otp) return json({ otpRequired: true });
      const step = await verifyTotp(secret, String(body.otp || ""), user.last_totp_step);
      if (step === null) { await failed(result.key); return error("קוד האימות שגוי", 401); }
      const updated = await database().prepare("UPDATE users SET last_totp_step = ?, status = 'active' WHERE id = ? AND last_totp_step < ? AND status = ?").bind(step, user.id, step, user.status).run();
      if (updated.meta.changes !== 1) return error("קוד האימות כבר שימש", 401);
      await clearAttempts(result.key);
      return json({ authenticated: true, user: publicUser({ ...user, status: "active" }) }, 200, sessionCookie(await createSession(user.id)));
    }
    const user = await sessionUser(request);
    if (!user) return error("נדרש אימות", 401);
    if (action === "logout") {
      const token = request.headers.get("cookie")?.match(/(?:^|;\s*)priolab_session=([a-f0-9]{64})/)?.[1];
      if (token) await database().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
      return json({ ok: true }, 200, sessionCookie("", 0));
    }
    if (action === "reports.save") {
      if (user.role === "viewer") return error("אין הרשאת עריכה", 403);
      const description = String(body.description || "").trim(), year = Number(body.taxYear), from = Number(body.from), to = Number(body.to), filename = String(body.filename || "").slice(0, 180), rows = body.rows;
      if (!description || description.length > 100 || !Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 12 || from > to || !Array.isArray(rows) || rows.length < 2 || rows.length > 5000) return error("פרטי הדוח אינם תקינים");
      const sections = new Set(["הכנסות", "עלות המכירות", "הוצאות הנהלה וכלליות", "הוצאות מימון", "מיסים שוטפים"]);
      if (rows.some(row => typeof row !== "object" || !row || !sections.has(row.section) || !Number.isFinite(row.amount) || String(row.name || "").length > 500 || String(row.group || "").length > 200 || String(row.account || "").length > 50)) return error("תוכן הדוח אינו תקין");
      const data = JSON.stringify(rows);
      if (data.length > 1_500_000) return error("הדוח גדול מדי", 413);
      const old = await database().prepare("SELECT id FROM reports WHERE tax_year = ? AND from_month = ? AND to_month = ? AND description = ?").bind(year, from, to, description).first<{ id: string }>();
      const id = old?.id || crypto.randomUUID();
      if (old) await database().prepare("UPDATE reports SET filename = ?, rows_json = ?, updated_at = ?, created_by = ? WHERE id = ?").bind(filename, data, now(), user.id, id).run();
      else await database().prepare("INSERT INTO reports (id, description, tax_year, from_month, to_month, filename, rows_json, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, description, year, from, to, filename, data, user.id, now()).run();
      return json({ id, replaced: !!old });
    }
    if (user.role !== "admin") return error("אין הרשאת מנהל", 403);
    if (action === "users.create") {
      const username = usernameOf(body.username), role = String(body.role || "viewer");
      if (!validUsername(username) || !validPassword(body.password) || !["admin", "editor", "viewer"].includes(role)) return error("פרטי המשתמש אינם תקינים");
      if (await getUser(username)) return error("שם המשתמש כבר קיים", 409);
      const salt = randomHex(16), secret = newTotpSecret();
      await database().prepare("INSERT INTO users (id, username, salt, password_hash, totp_secret, last_totp_step, role, status, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, -1, ?, 'pending', 1, ?)").bind(crypto.randomUUID(), username, salt, await passwordHash(String(body.password), salt), await encryptTotp(secret, encryptionKey()), role, now()).run();
      return json({ ok: true }, 201);
    }
    if (action === "users.toggle") {
      const id = String(body.id || ""), target = await database().prepare("SELECT id, role, status FROM users WHERE id = ?").bind(id).first<Pick<UserRow, "id" | "role" | "status">>();
      if (!target || target.status === "pending" || id === user.id) return error("לא ניתן לשנות משתמש זה");
      if (target.role === "admin" && target.status === "active") {
        const count = await database().prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active'").first<{ total: number }>();
        if ((count?.total || 0) <= 1) return error("נדרש מנהל פעיל אחד לפחות");
      }
      const status = target.status === "active" ? "disabled" : "active";
      await database().prepare("UPDATE users SET status = ? WHERE id = ?").bind(status, id).run();
      await database().prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
      return json({ status });
    }
    if (action === "users.reset") {
      const id = String(body.id || ""), target = await database().prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
      if (!target || id === user.id || !validPassword(body.password)) return error("לא ניתן לאפס משתמש זה");
      const salt = randomHex(16), secret = newTotpSecret();
      await database().prepare("UPDATE users SET salt = ?, password_hash = ?, totp_secret = ?, last_totp_step = -1, status = 'pending', must_change_password = 1 WHERE id = ?").bind(salt, await passwordHash(String(body.password), salt), await encryptTotp(secret, encryptionKey()), id).run();
      await database().prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
      return json({ ok: true });
    }
    if (action === "ips.add") {
      const address = String(body.address || "").trim().toLowerCase();
      if (!validIp(address)) return error("כתובת IP אינה תקינה");
      await database().prepare("INSERT OR IGNORE INTO ip_allowlist (address, created_by, created_at) VALUES (?, ?, ?)").bind(address, user.id, now()).run();
      return json({ ok: true });
    }
    if (action === "ips.remove") {
      const address = String(body.address || "").trim().toLowerCase(), setting = await database().prepare("SELECT value FROM settings WHERE key = ?").bind("ip_enforced").first<{ value: string }>();
      if (setting?.value === "1" && address === clientIp(request)) return error("לא ניתן להסיר את הכתובת הנוכחית כשההגבלה פעילה");
      await database().prepare("DELETE FROM ip_allowlist WHERE address = ?").bind(address).run();
      return json({ ok: true });
    }
    if (action === "ips.enforce") {
      const enabled = body.enabled === true, ip = clientIp(request);
      if (enabled && (!ip || !(await database().prepare("SELECT address FROM ip_allowlist WHERE address = ?").bind(ip).first()))) return error("הוסף קודם את כתובת ה־IP הנוכחית לרשימה", 400);
      await database().prepare("INSERT INTO settings (key, value) VALUES ('ip_enforced', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(enabled ? "1" : "0").run();
      return json({ enabled });
    }
    return error("פעולה לא מוכרת", 404);
  } catch (cause) { console.error("Secure API POST failed", cause); return error("הפעולה נכשלה. נסה שוב מאוחר יותר", 503); }
}
