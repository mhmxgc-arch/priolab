"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ReportFile = {
  id: string; description: string; filename: string; taxYear: number;
  fromMonth: number; toMonth: number; hidden: number; updatedAt: number;
  rowCount: number; legacyPeriod: number;
};

async function request(companyId: string, action: string, values?: Record<string, unknown>) {
  const response = await fetch(values ? "/api/secure" : `/api/secure?action=${action}&companyId=${encodeURIComponent(companyId)}`, {
    method: values ? "POST" : "GET", cache: "no-store",
    headers: values ? { "Content-Type": "application/json" } : undefined,
    body: values ? JSON.stringify({ action, ...values, companyId }) : undefined,
  });
  const data = await response.json() as { error?: string; reports?: ReportFile[] };
  if (!response.ok) throw new Error(data.error || "הפעולה נכשלה");
  return data;
}

function period(file: ReportFile) {
  return file.legacyPeriod ? `${file.taxYear} · תקופה לא ידועה` : `${file.taxYear} · חודשים ${file.fromMonth}–${file.toMonth}`;
}

export function ReportFiles({ companyId }: { companyId: string }) {
  const [files, setFiles] = useState<ReportFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [year, setYear] = useState("");
  const [toDelete, setToDelete] = useState<ReportFile | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const refresh = useCallback(async () => {
    const data = await request(companyId, "reports.manage");
    if (!Array.isArray(data.reports)) throw new Error("רשימת הדוחות אינה זמינה כעת");
    setFiles(data.reports);
    setLoaded(true);
  }, [companyId]);
  const load = useCallback(async () => {
    setLoading(true); setFailure("");
    try { await refresh(); }
    catch (error) { setFailure((error as Error).message); }
    finally { setLoading(false); }
  }, [refresh]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (toDelete && !dialog.current?.open) dialog.current?.showModal();
    if (!toDelete && dialog.current?.open) dialog.current.close();
  }, [toDelete]);

  const years = useMemo(() => [...new Set(files.map(file => file.taxYear))].sort((a, b) => b - a), [files]);
  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return files.filter(file => (!query || `${file.filename} ${file.description}`.toLocaleLowerCase().includes(query))
      && (!year || String(file.taxYear) === year)
      && (status === "all" || (status === "hidden" ? !!file.hidden : !file.hidden)));
  }, [files, search, status, year]);
  const hiddenCount = files.filter(file => file.hidden).length;

  async function change(action: "reports.visibility" | "reports.delete", file: ReportFile) {
    setBusy(true); setNotice(""); setFailure("");
    try {
      await request(companyId, action, { id: file.id, ...(action === "reports.visibility" ? { hidden: !file.hidden } : {}) });
      setToDelete(null);
      await refresh();
      setNotice(action === "reports.delete" ? "הדוח והנתונים שלו נמחקו מהמערכת" : file.hidden ? "הדוח הוחזר לדשבורד ולהשוואות" : "הדוח הוסתר מהדשבורד ומההשוואות. ניתן להחזירו בכל עת");
    } catch (error) { setFailure((error as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="files-page">
    <div className="files-heading"><div><h1>ניהול קבצים נטענים</h1><p>הסתרת דוח שומרת את הנתונים ומוציאה אותו מהדשבורד ומההשוואות. מחיקה מסירה את הדוח ואת הנתונים שנקלטו ממנו.</p></div><button className="file-action" disabled={busy || loading} onClick={() => void load()}>רענון רשימה</button></div>
    <div className="files-summary" aria-label="סיכום דוחות"><span><b>{files.length}</b> דוחות במערכת</span><span><b>{files.length - hiddenCount}</b> מוצגים</span><span><b>{hiddenCount}</b> מוסתרים</span></div>
    <div className="files-filters">
      <label>חיפוש קובץ או תיאור<input type="search" value={search} placeholder="שם הקובץ או תיאור הדוח" onChange={event => setSearch(event.target.value)} /></label>
      <label>שנת מס<select value={year} onChange={event => setYear(event.target.value)}><option value="">כל השנים</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>מצב תצוגה<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">כל הדוחות</option><option value="visible">מוצגים בלבד</option><option value="hidden">מוסתרים בלבד</option></select></label>
    </div>
    {notice && <div className="files-success" role="status">{notice}</div>}
    {failure && <div className="notice" role="alert">{failure}</div>}
    <div className="files-panel" aria-busy={loading || busy}>
      {loading ? <p className="files-empty" role="status">טוען את רשימת הדוחות…</p> : !loaded ? <div className="files-empty"><p>לא ניתן לטעון את הרשימה כעת.</p><button className="file-action" onClick={() => void load()}>נסה שוב</button></div> : files.length === 0 ? <div className="files-empty"><strong>אין קבצים טעונים במערכת</strong><p>ניתן לטעון דוח Excel ממסך ״דוחות וניתוח״.</p></div> : matches.length === 0 ? <div className="files-empty"><p>לא נמצאו דוחות התואמים לסינון.</p><button className="file-action" onClick={() => { setSearch(""); setYear(""); setStatus("all"); }}>ניקוי סינון</button></div> : <div className="files-scroll"><table className="files-table"><caption>{matches.length} דוחות ברשימה</caption><thead><tr><th scope="col">קובץ ותיאור</th><th scope="col">תקופת דיווח</th><th scope="col">שורות</th><th scope="col">מצב</th><th scope="col">עדכון אחרון</th><th scope="col">פעולות</th></tr></thead><tbody>{matches.map(file => <tr key={file.id} className={file.hidden ? "file-hidden" : ""}>
        <td><strong>{file.description}</strong><small className="file-name" dir="auto">{file.filename || "שם קובץ לא זמין"}</small></td><td>{period(file)}</td><td>{file.rowCount.toLocaleString("he-IL")}</td><td><span className={`file-status ${file.hidden ? "hidden" : "visible"}`}>{file.hidden ? "מוסתר" : "מוצג"}</span></td><td>{new Date(file.updatedAt).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</td><td><div className="file-actions"><button className="file-action" disabled={busy} onClick={() => void change("reports.visibility", file)} aria-label={`${file.hidden ? "החזרת" : "הסתרת"} ${file.description}`}>{file.hidden ? "החזרה לתצוגה" : "הסתרה"}</button><button className="file-action danger" disabled={busy} onClick={() => { setFailure(""); setToDelete(file); }} aria-label={`מחיקת ${file.description}`}>מחיקה</button></div></td>
      </tr>)}</tbody></table></div>}
    </div>
    <dialog ref={dialog} className="file-delete-dialog" aria-labelledby="file-delete-title" aria-describedby="file-delete-description" onCancel={event => { if (busy) event.preventDefault(); else setToDelete(null); }} onClose={() => setToDelete(null)}>
      <h2 id="file-delete-title">מחיקת דוח מהמערכת</h2><p><strong>{toDelete?.description}</strong></p><p className="file-name" dir="auto">{toDelete?.filename}</p><p id="file-delete-description">הדוח והנתונים שנקלטו ממנו יימחקו. לא ניתן לבטל את המחיקה. אפשר לבחור ״הסתרה״ אם רוצים לשמור אותם.</p>
      {failure && <div className="notice" role="alert">{failure}</div>}
      <div className="file-dialog-actions"><button className="file-action" disabled={busy} onClick={() => setToDelete(null)} autoFocus>ביטול</button><button className="file-action danger" disabled={busy || !toDelete} onClick={() => toDelete && void change("reports.delete", toDelete)}>{busy ? "מוחק…" : "מחק דוח ונתונים"}</button></div>
    </dialog>
  </section>;
}
