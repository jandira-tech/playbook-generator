// Demo mode: without ADMIN_TOKEN nobody can read stored playbooks (backend/auth.ts), so
// storing a visitor's submission would keep personal data no one may use. The val then
// validates submissions and stores nothing. No SQLite / OpenAI imports: testable offline.

/** True when submissions should be stored: only when an admin can read them back. */
export function persistenceEnabled(getToken: () => string | undefined): boolean {
  return (getToken() ?? "").trim() !== "";
}
