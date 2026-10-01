"use client";
import { useEffect, useState } from "react";
export type Company = { id: string; name: string; registration: string };
type User = { id: string; username: string; role: string };
async function api(action: string, values?: Record<string, unknown>, companyId = "") {
  const response = await fetch(values ? "/api/secure" : `/api/secure?action=${action}&companyId=${encodeURIComponent(companyId)}`, { cache: "no-store", method: values ? "POST" : "GET", headers: values ? {"Content-Type":"application/json"} : undefined, body: values ? JSON.stringify({action,...values}) : undefined });
  const data = await response.json() as {error?: string; members: {userId: string}[]}; if (!response.ok) throw Error(data.error || "הפעולה נכשלה"); return data;
}
export function CompanySettings({ companies, users, refresh }: { companies: Company[]; users: User[]; refresh: () => Promise<void> }) {
  const [name,setName]=useState(""); const [registration,setRegistration]=useState(""); const [selected,setSelected]=useState(""); const [members,setMembers]=useState<string[]>([]); const [notice,setNotice]=useState(""); const [busy,setBusy]=useState(false); const [loaded,setLoaded]=useState(false);
  useEffect(()=>{setLoaded(false);setMembers([]);if(!selected)return;let cancelled=false;api("companies.members",undefined,selected).then(data=>{if(!cancelled){setMembers(data.members.map((m:{userId:string})=>m.userId));setLoaded(true);}}).catch(error=>{if(!cancelled)setNotice(error.message);});return()=>{cancelled=true;};},[selected]);
  async function save(action:string,values:Record<string,unknown>){setBusy(true);setNotice("");try{await api(action,values);await refresh();setNotice("השינויים נשמרו");return true;}catch(error){setNotice((error as Error).message);return false;}finally{setBusy(false);}}
  return <article className="panel company-settings"><h2>חברות וסביבות ניתוח</h2><p className="hint">כל חברה מחזיקה דוחות וניתוחים נפרדים. מנהלי מערכת מורשים לכל החברות; משתמשים אחרים חייבים שיוך מפורש.</p>
    <form className="add-form" onSubmit={async e=>{e.preventDefault();if(await save("companies.create",{name,registration})){setName("");setRegistration("");}}}><h3>הקמת חברה</h3><div className="form-line"><input aria-label="שם חברה" placeholder="שם חברה" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/><input aria-label="מספר חברה" placeholder="ח.פ. (אופציונלי)" maxLength={30} value={registration} onChange={e=>setRegistration(e.target.value)}/><button className="primary" disabled={busy}>הקמת חברה</button></div></form>
    <label className="company-select">ניהול גישה לחברה<select value={selected} onChange={e=>{setSelected(e.target.value);setNotice("");}}><option value="">בחר חברה</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {selected && <div className="rows">{!loaded?<p>טוען הרשאות…</p>:users.filter(u=>u.role!=="admin").length===0?<p className="hint">אין משתמשים רגילים לשיוך. ניתן להוסיף אותם באזור המשתמשים.</p>:users.filter(u=>u.role!=="admin").map(u=><label className="list-row" key={u.id}><span>{u.username} · {u.role==="editor"?"עורך":"צופה"}</span><input type="checkbox" checked={members.includes(u.id)} disabled={busy} onChange={async e=>{const enabled=e.target.checked;if(await save("companies.membership",{companyId:selected,userId:u.id,enabled}))setMembers(current=>enabled?[...current,u.id]:current.filter(id=>id!==u.id));}}/></label>)}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
  </article>;
}
