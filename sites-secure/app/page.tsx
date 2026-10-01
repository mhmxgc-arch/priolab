"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";

type User = { id: string; username: string; role: string; status: string; created_at?: number };
type Rule = { address: string; created_at: number };
type Settings = { users: User[]; ipRules: Rule[]; ipEnforced: boolean; currentIp: string | null };

export default function Home() {
  const [version, setVersion] = useState("2.1.3");
  const [setup, setSetup] = useState(false);
  const [setupUnavailable, setSetupUnavailable] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<"reports" | "settings">("reports");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [changeRequired, setChangeRequired] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpRequired, setOtpRequired] = useState(false);
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "viewer" });
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [clockWarning, setClockWarning] = useState(false);
  const [loading, setLoading] = useState(true);

  const get = useCallback(async (action: string) => {
    const response = await fetch(`/api/secure?action=${action}`, { cache: "no-store" });
    const data = await response.json() as any;
    if (!response.ok) throw new Error(data.error || "הפעולה נכשלה");
    return data;
  }, []);
  const post = useCallback(async (action: string, values: Record<string, unknown> = {}) => {
    const response = await fetch("/api/secure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...values }) });
    const data = await response.json() as any;
    if (typeof data.serverTime === "number") setClockWarning(Math.abs(Date.now() - data.serverTime) > 60_000);
    if (response.status === 429 && typeof data.retryAfter === "number") {
      setLockedUntil(Date.now() + data.retryAfter * 1000);
      setLockSeconds(data.retryAfter);
    }
    if (!response.ok) throw new Error(data.error || "הפעולה נכשלה");
    return data;
  }, []);
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setLockSeconds(remaining);
      if (!remaining) {
        setLockedUntil(0);
        setNotice(current => current.startsWith("יותר מדי ניסיונות") ? "החסימה הסתיימה. ניתן לנסות שוב עם קוד חדש מהאפליקציה" : current);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);
  const refreshSettings = useCallback(async () => setSettings(await get("settings")), [get]);
  useEffect(() => { get("status").then(data => { setVersion(data.version); setSetup(data.setup); setSetupUnavailable(!!data.setupUnavailable); setUser(data.user); }).catch((error: Error) => setNotice(error.message)).finally(() => setLoading(false)); }, [get]);
  useEffect(() => { if (view === "settings" && user?.role === "admin") refreshSettings().catch((error: Error) => setNotice(error.message)); }, [view, user, refreshSettings]);
  async function act(action: string, values: Record<string, unknown>, message = "השינויים נשמרו") {
    setBusy(true); setNotice("");
    try { await post(action, values); await refreshSettings(); setNotice(message); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function submitLogin(event: FormEvent) {
    event.preventDefault(); if (lockSeconds) return; setBusy(true); setNotice("");
    try {
      if (changeRequired && newPassword !== confirmPassword) throw new Error("אימות הסיסמה החדשה אינו תואם");
      const result = await post(setup ? "bootstrap" : changeRequired ? "password.change" : enrollment ? "enroll" : "login", { username, password, otp, ...(changeRequired ? { newPassword } : {}) });
      if (result.changeRequired) { setSetup(false); setChangeRequired(true); setOtpRequired(false); setOtp(""); }
      else if (result.enroll) { setEnrollment({ secret: result.secret, uri: result.uri }); setChangeRequired(false); setPassword(newPassword || password); setNewPassword(""); setConfirmPassword(""); setOtp(""); }
      else if (result.otpRequired) setOtpRequired(true);
      else { setUser(result.user); setEnrollment(null); setPassword(""); setOtpRequired(false); setOtp(""); }
    } catch (error) { setOtp(""); setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() { try { await post("logout"); setUser(null); setSettings(null); setView("reports"); setEnrollment(null); setChangeRequired(false); setOtpRequired(false); } catch (error) { setNotice((error as Error).message); } }
  if (loading) return <main className="auth-shell"><div className="auth-card">טוען…</div></main>;
  if (!user) return <main className="auth-shell"><div className="auth-card">
    <img className="login-logo" src="/xpress.png" alt="Xpress Technologies" /><p className="eyebrow">PRIO LAB · XPRESS TECHNOLOGIES</p><h1>מרכז ניתוח פיננסי</h1><p className="muted">גישה מאובטחת לדוחות רווח והפסד</p>
    {setupUnavailable ? <div className="notice" role="alert">מנהל ראשוני טרם הוגדר. מפעיל השרת צריך להקים אותו מתוך השרת, ואז ניתן יהיה להיכנס כאן.</div> :
    <form onSubmit={submitLogin} className="stack">
      <label>שם משתמש<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /></label>
      <label>{changeRequired ? "סיסמה ראשונית" : "סיסמה"}<input type="password" autoComplete={setup ? "new-password" : "current-password"} required minLength={setup ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {changeRequired && <div className="password-change"><strong>יש להחליף סיסמה לפני הכניסה</strong><p>לפחות 8 תווים, כולל אות גדולה, אות קטנה, ספרה וסימן מיוחד. לאחר מכן תחבר את Google Authenticator.</p><label>סיסמה חדשה<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label><label>אימות סיסמה חדשה<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label></div>}
      {enrollment && <div className="enroll"><strong>חיבור Google Authenticator</strong><p>פתחו את Google Authenticator, לחצו על + ובחרו ״סריקת קוד QR״. סרקו את הקוד הבא:</p><div className="enrollment-qr"><QRCodeSVG value={enrollment.uri} size={224} level="M" marginSize={4} title="קוד QR לחיבור Google Authenticator" /></div><p className="muted">לאחר הסריקה הזינו למטה את הקוד בן שש הספרות של חשבון Priolab. ודאו שבטלפון מוגדרים תאריך ושעה אוטומטיים.</p></div>}
      {!setup && !changeRequired && (otpRequired || enrollment) && <label>קוד Google Authenticator<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" placeholder="000000" required value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ""))} /></label>}
      {clockWarning && <div className="notice" role="alert">שעון המכשיר שונה משעון השרת. בדקו שהזמן מסונכרן אוטומטית במחשב ובטלפון; אם ההודעה נמשכת יש לבדוק את שעון השרת.</div>}
      {notice && <div className="notice" role="alert">{notice}</div>}
      {lockSeconds > 0 && <p className="lock-countdown" role="status">אפשר לנסות שוב בעוד {lockSeconds} שניות</p>}
      <button disabled={busy || lockSeconds > 0} className="primary">{busy ? "מאמת…" : setup ? "יצירת מנהל ראשי" : changeRequired ? "החלפת סיסמה והמשך" : enrollment ? "סיום הגדרה וכניסה" : "כניסה למערכת"}</button>
      {(enrollment || changeRequired || otpRequired) && <button type="button" disabled={busy} className="auth-back" onClick={() => { setEnrollment(null); setChangeRequired(false); setOtpRequired(false); setPassword(""); setNewPassword(""); setConfirmPassword(""); setOtp(""); setNotice(""); }}>חזרה לכניסה</button>}
    </form>}<footer>גרסה {version} · גישה למורשים בלבד</footer>
  </div></main>;
  return <main className="app-shell"><header className="topbar"><div className="topbrand"><img className="header-logo" src="/xpress.png" alt="Xpress Technologies" /><span><b>Priolab</b><small>מערכת ניתוח פיננסי</small></span></div><nav><button className={view === "reports" ? "selected" : ""} onClick={() => setView("reports")}>דוחות וניתוח</button>{user.role === "admin" && <button className={view === "settings" ? "selected" : ""} onClick={() => setView("settings")}>הגדרות ואבטחה</button>}</nav><div className="account"><span>{user.username} · {user.role === "admin" ? "מנהל" : user.role === "editor" ? "עורך" : "צופה"}</span><button onClick={logout}>יציאה</button></div></header>
    {view === "reports" ? <iframe title="דוחות וניתוח פיננסי" className="report-frame" src="/dashboard.html" /> : <section className="settings-page"><div className="settings-head"><p className="eyebrow">ADMINISTRATION</p><h1>הגדרות ואבטחה</h1><p>ניהול משתמשים, אימות דו־שלבי וכתובות מורשות</p></div>{notice && <div className="notice" role="status">{notice}</div>}{settings && <div className="settings-grid">
      <article className="panel"><div className="panel-title"><div><h2>משתמשים</h2><p>לכל משתמש סיסמה וקוד אימות משלו</p></div><span className="count">{settings.users.length}</span></div><div className="rows">{settings.users.map(item => <div className="list-row" key={item.id}><div><strong>{item.username}</strong><small>{item.role === "admin" ? "מנהל" : item.role === "editor" ? "עורך" : "צופה"} · {item.status === "active" ? "פעיל" : item.status === "pending" ? "ממתין להגדרת אימות" : "מושבת"}</small></div>{item.id !== user.id && <div className="actions"><button disabled={busy} onClick={() => { const password = prompt(`סיסמה ראשונית עבור ${item.username} (8 תווים לפחות)`); if (password) act("users.reset", { id: item.id, password }, "הסיסמה אופסה. המשתמש יחליף אותה ויחבר Authenticator מחדש."); }}>איפוס</button>{item.status !== "pending" && <button disabled={busy} onClick={() => act("users.toggle", { id: item.id })}>{item.status === "active" ? "השבתה" : "הפעלה"}</button>}</div>}</div>)}</div><form className="add-form" onSubmit={e => { e.preventDefault(); act("users.create", newUser, "המשתמש נוצר. בכניסה הראשונה יחליף סיסמה ויחבר Google Authenticator.").then(() => setNewUser({ username: "", password: "", role: "viewer" })); }}><h3>הוספת משתמש</h3><div className="form-line"><input required placeholder="שם משתמש" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} /><input type="password" minLength={8} required placeholder="סיסמה ראשונית (8+ תווים)" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} /><select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}><option value="viewer">צופה</option><option value="editor">עורך</option><option value="admin">מנהל</option></select><button disabled={busy} className="primary">הוספה</button></div></form></article>
      <article className="panel"><div className="panel-title"><div><h2>רשימת כתובות IP מורשות</h2><p>כאשר האכיפה מופעלת, רק כתובות ברשימה יוכלו להשתמש במערכת</p></div></div><div className="enforce"><div><strong>אכיפת רשימה לבנה</strong><small>הכתובת הנוכחית: <span dir="ltr">{settings.currentIp || "לא זוהתה"}</span></small></div><button disabled={busy} className={settings.ipEnforced ? "on" : ""} onClick={() => act("ips.enforce", { enabled: !settings.ipEnforced }, settings.ipEnforced ? "הגבלת ה־IP כובתה" : "הגבלת ה־IP הופעלה")}>{settings.ipEnforced ? "מופעלת" : "כבויה"}</button></div><div className="rows">{settings.ipRules.map(rule => <div className="list-row" key={rule.address}><strong dir="ltr">{rule.address}</strong><button disabled={busy} onClick={() => act("ips.remove", { address: rule.address })}>הסרה</button></div>)}</div><form className="add-form" onSubmit={e => { e.preventDefault(); act("ips.add", { address }).then(() => setAddress("")); }}><h3>הוספת כתובת</h3><div className="form-line"><input dir="ltr" placeholder="192.0.2.10" required value={address} onChange={e => setAddress(e.target.value)} /><button disabled={busy} className="primary">הוספה</button>{settings.currentIp && <button type="button" disabled={busy} onClick={() => act("ips.add", { address: settings.currentIp })}>הוספת הכתובת שלי</button>}</div></form><p className="hint">הוסף את הכתובת הנוכחית לפני הפעלת האכיפה. כתובת משתנה תחייב עדכון ברשימה ממיקום מורשה.</p></article>
      <article className="panel version-panel"><h2>גרסת המערכת</h2><strong dir="ltr">v{version}</strong><p>הגרסה מוצגת גם במסך האימות.</p></article>
    </div>}</section>}</main>;
}
