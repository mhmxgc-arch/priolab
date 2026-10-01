import { database, type SessionUser } from "./server";

// Every future module uses the same authenticated company boundary.
export const ANALYSIS_MODULES = [
  { key: "pnl", name: "רווח והפסד", available: true },
  { key: "balance", name: "מאזן שנתי", available: false },
] as const;
export async function companyAccess(user: SessionUser, companyId: string): Promise<boolean> {
  if (!companyId || companyId.length > 100) return false;
  const company = await database().prepare("SELECT id FROM companies WHERE id = ?").bind(companyId).first();
  if (!company) return false;
  if (user.role === "admin") return true;
  return !!await database().prepare("SELECT user_id FROM company_members WHERE company_id = ? AND user_id = ?").bind(companyId, user.id).first();
}
