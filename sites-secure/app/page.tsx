"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type User = { id: string; username: string; role: string; status: string; created_at?: number };
type Rule = { address: string; created_at: number };
type Settings = { users: User[]; ipRules: Rule[]; ipEnforced: boolean; currentIp: string | null };

export default function Home() {
  const [version, setVersion] = useState("2.0.1");
  const [setup, setSetup] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<"reports" | "settings">("reports");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "viewer" });
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
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
    if (!response.ok) throw new Error(data.error || "הפעולה נכשלה");
    return data;
  }, []);
  const refreshSettings = useCallback(async () => setSettings(await get("settings")), [get]);
  useEffect(() => { get("status").then(data => { setVersion(data.version); setSetup(data.setup); setUser(data.user); }).catch((error: Error) => setNotice(error.message)).finally(() => setLoading(false)); }, [get]);
  useEffect(() => { if (view === "settings" && user?.role === "admin") refreshSettings().catch((error: Error) => setNotice(error.message)); }, [view, user, refreshSettings]);
  async function act(action: string, values: Record<string, unknown>, message = "השינויים נשמרו") {
    setBusy(true); setNotice("");
    try { await post(action, values); await refreshSettings(); setNotice(message); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function submitLogin(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const result = await post(setup ? "bootstrap" : enrollment ? "enroll" : "login", { username, password, otp });
      if (result.enroll) { setEnrollment({ secret: result.secret, uri: result.uri }); setSetup(false); setOtp(""); }
      else { setUser(result.user); setEnrollment(null); setPassword(""); setOtp(""); }
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() { try { await post("logout"); setUser(null); setSettings(null); setView("reports"); setEnrollment(null); } catch (error) { setNotice((error as Error).message); } }
  if (loading) return <main className="auth-shell"><div className="auth-card">טוען…</div></main>;
  if (!user) return <main className="auth-shell"><div className="auth-card">
    <div className="brand-mark">P</div><p className="eyebrow">PRIO LAB · XPRESS TECHNOLOGIES</p><h1>מרכז ניתוח פיננסי</h1><p className="muted">גישה מאובטחת לדוחות רווח והפסד</p>
    <form onSubmit={submitLogin} className="stack">
      <label>שם משתמש<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /></label>
      <label>סיסמה<input type="password" autoComplete={setup ? "new-password" : "current-password"} required minLength={setup ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {enrollment && <div className="enroll"><strong>חיבור Google Authenticator</strong><p>פתחו את האפליקציה, בחרו הוספת חשבון והזינו את מפתח ההגדרה:</p><code dir="ltr">{enrollment.secret}</code><p className="muted">לאחר מכן הזינו את הקוד בן שש הספרות. שמרו את המפתח במקום בטוח.</p></div>}
      {!setup && <label>קוד Google Authenticator<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" placeholder="000000" required={!enrollment} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ""))} /></label>}
      {notice && <div className="notice" role="alert">{notice}</div>}
      <button disabled={busy} className="primary">{busy ? "מאמת…" : setup ? "יצירת מנהל ראשי" : enrollment ? "סיום הגדרה וכניסה" : "כניסה למערכת"}</button>
    </form><footer>גרסה {version} · גישה למורשים בלבד</footer>
  </div></main>;
  return <main className="app-shell"><header className="topbar"><div className="topbrand"><span className="brand-mark mini">P</span><span><b>Priolab</b><small>מערכת ניתוח פיננסי</small></span></div><nav><button className={view === "reports" ? "selected" : ""} onClick={() => setView("reports")}>דוחות וניתוח</button>{user.role === "admin" && <button className={view === "settings" ? "selected" : ""} onClick={() => setView("settings")}>הגדרות ואבטחה</button>}</nav><div className="account"><span>{user.username} · {user.role === "admin" ? "מנהל" : user.role === "editor" ? "עורך" : "צופה"}</span><button onClick={logout}>יציאה</button></div></header>
    {view === "reports" ? <iframe title="דוחות וניתוח פיננסי" className="report-frame" src="/dashboard.html" /> : <section className="settings-page"><div className="settings-head"><p className="eyebrow">ADMINISTRATION</p><h1>הגדרות ואבטחה</h1><p>ניהול משתמשים, אימות דו־שלבי וכתובות מורשות</p></div>{notice && <div className="notice" role="status">{notice}</div>}{settings && <div className="settings-grid">
      <article className="panel"><div className="panel-title"><div><h2>משתמשים</h2><p>לכל משתמש סיסמה וקוד אימות משלו</p></div><span className="count">{settings.users.length}</span></div><div className="rows">{settings.users.map(item => <div className="list-row" key={item.id}><div><strong>{item.username}</strong><small>{item.role === "admin" ? "מנהל" : item.role === "editor" ? "עורך" : "צופה"} · {item.status === "active" ? "פעיל" : item.status === "pending" ? "ממתין להגדרת אימות" : "מושבת"}</small></div>{item.id !== user.id && <div className="actions"><button disabled={busy} onClick={() => { const password = prompt(`סיסמה חדשה עבור ${item.username} (12 תווים לפחות)`); if (password) act("users.reset", { id: item.id, password }, "הסיסמה וקוד האימות אופסו. המשתמש יגדיר Authenticator מחדש."); }}>איפוס</button>{item.status !== "pending" && <button disabled={busy} onClick={() => act("users.toggle", { id: item.id })}>{item.status === "active" ? "השבתה" : "הפעלה"}</button>}</div>}</div>)}</div><form className="add-form" onSubmit={e => { e.preventDefault(); act("users.create", newUser, "המשתמש נוצר. בכניסה הראשונה יחבר Google Authenticator.").then(() => setNewUser({ username: "", password: "", role: "viewer" })); }}><h3>הוספת משתמש</h3><div className="form-line"><input required placeholder="שם משתמש" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} /><input type="password" minLength={12} required placeholder="סיסמה ראשונית (12+ תווים)" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} /><select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}><option value="viewer">צופה</option><option value="editor">עורך</option><option value="admin">מנהל</option></select><button disabled={busy} className="primary">הוספה</button></div></form></article>
      <article className="panel"><div className="panel-title"><div><h2>רשימת כתובות IP מורשות</h2><p>כאשר האכיפה מופעלת, רק כתובות ברשימה יוכלו להשתמש במערכת</p></div></div><div className="enforce"><div><strong>אכיפת רשימה לבנה</strong><small>הכתובת הנוכחית: <span dir="ltr">{settings.currentIp || "לא זוהתה"}</span></small></div><button disabled={busy} className={settings.ipEnforced ? "on" : ""} onClick={() => act("ips.enforce", { enabled: !settings.ipEnforced }, settings.ipEnforced ? "הגבלת ה־IP כובתה" : "הגבלת ה־IP הופעלה")}>{settings.ipEnforced ? "מופעלת" : "כבויה"}</button></div><div className="rows">{settings.ipRules.map(rule => <div className="list-row" key={rule.address}><strong dir="ltr">{rule.address}</strong><button disabled={busy} onClick={() => act("ips.remove", { address: rule.address })}>הסרה</button></div>)}</div><form className="add-form" onSubmit={e => { e.preventDefault(); act("ips.add", { address }).then(() => setAddress("")); }}><h3>הוספת כתובת</h3><div className="form-line"><input dir="ltr" placeholder="192.0.2.10" required value={address} onChange={e => setAddress(e.target.value)} /><button disabled={busy} className="primary">הוספה</button>{settings.currentIp && <button type="button" disabled={busy} onClick={() => act("ips.add", { address: settings.currentIp })}>הוספת הכתובת שלי</button>}</div></form><p className="hint">הוסף את הכתובת הנוכחית לפני הפעלת האכיפה. כתובת משתנה תחייב עדכון ברשימה ממיקום מורשה.</p></article>
      <article className="panel version-panel"><h2>גרסת המערכת</h2><strong dir="ltr">v{version}</strong><p>הגרסה מוצגת גם במסך האימות.</p></article>
    </div>}</section>}</main>;
}
