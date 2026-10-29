import crypto from "crypto";

/**
 * The admin password, or null if admin protection is disabled.
 * ADMIN_PASSWORD is the documented name; ADMIN_API_KEY is still accepted.
 */
export function adminKey(): string | null {
  const k = (process.env.ADMIN_PASSWORD || process.env.ADMIN_API_KEY)?.trim();
  return k && k.length > 0 ? k : null;
}

/** Whether mutating endpoints require the admin password. */
export function isAuthRequired(): boolean {
  return adminKey() !== null;
}

/** Whether the whole site is behind HTTP Basic Auth (DASHBOARD_USER + DASHBOARD_PASSWORD). */
export function isSitePrivate(): boolean {
  return !!(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/** Extract the provided key from headers (x-api-key or Authorization: Bearer). */
function providedKey(req: Request): string | null {
  const direct = req.headers.get("x-api-key");
  if (direct) return direct.trim();
  const auth = req.headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return null;
}

/**
 * Returns true if the request is allowed to perform admin/mutating actions.
 * Open (true) when no password is configured; otherwise requires a match.
 */
export function checkAdmin(req: Request): boolean {
  const key = adminKey();
  if (!key) return true; // open mode
  const provided = providedKey(req);
  return provided !== null && constantTimeEqual(provided, key);
}

/** One startup line describing who can see and manage the dashboard. */
export function accessModeSummary(): string {
  const admin = isAuthRequired();
  if (isSitePrivate()) {
    return admin
      ? "[auth] Private site: DASHBOARD_USER/PASSWORD is required to view anything; ADMIN_PASSWORD additionally gates management. For public viewing with an admin login, unset DASHBOARD_USER/PASSWORD."
      : "[auth] Private site: DASHBOARD_USER/PASSWORD is required to view anything, and anyone logged in can manage. For public viewing with an admin login, unset DASHBOARD_USER/PASSWORD and set ADMIN_PASSWORD instead.";
  }
  return admin
    ? "[auth] Public viewing, admin login enabled: anyone on the network can view; ingest/rebuild/depots/saved ranges need ADMIN_PASSWORD."
    : "[auth] Open: anyone who can reach the dashboard can view AND manage it. Set ADMIN_PASSWORD to require an admin login for management.";
}
