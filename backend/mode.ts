// Admin reads: without ADMIN_TOKEN the library list of every stored playbook stays
// closed (backend/auth.ts). Confirmed submissions are still written to SQLite.
// The public sample is a separate route. No SQLite / OpenAI imports: testable offline.

/** True when an admin token is set, so the full library can be read back. */
export function persistenceEnabled(getToken: () => string | undefined): boolean {
  return (getToken() ?? "").trim() !== "";
}
