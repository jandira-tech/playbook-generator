import { fetchFamilyVersions, fetchPlaybook, fetchPlaybooks } from "./session.ts";

Deno.test("all library reads send the memory-only bearer token", async () => {
  const previous = globalThis.fetch;
  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
    const body = url.includes("/family/") ? { versions: [] }
      : url.includes("?vault=") ? { playbooks: [] }
      : { playbook: { id: 7 } };
    return Promise.resolve(Response.json(body));
  }) as typeof fetch;
  try {
    await fetchPlaybooks(false, "test-token");
    await fetchPlaybook(7, "test-token");
    await fetchFamilyVersions("family/a", "test-token");
    const expected = ["/api/playbooks?vault=exclude", "/api/playbooks/7", "/api/playbooks/family/family%2Fa"];
    if (requests.length !== 3 || requests.some((r, i) => r.url !== expected[i] || r.authorization !== "Bearer test-token")) {
      throw new Error("Library read request did not use the expected URL and authorization header");
    }
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("library reads surface rejected credentials", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("unauthorized", { status: 401 }))) as typeof fetch;
  try {
    let rejected = false;
    try { await fetchPlaybooks(true, "wrong"); } catch (error) { rejected = String(error).includes("401"); }
    if (!rejected) throw new Error("Rejected library credentials were not reported");
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("library client and protected routes interoperate", async () => {
  const { Hono } = await import("npm:hono");
  const { protectReads } = await import("../backend/auth.ts");
  const app = new Hono();
  protectReads(app, () => "local-test");
  app.get("/api/playbooks", (c) => c.json({ playbooks: [{ id: 7 }] }));
  app.get("/api/playbooks/:id", (c) => c.json({ playbook: { id: Number(c.req.param("id")) } }));
  app.get("/api/playbooks/family/:id", (c) => c.json({ versions: [{ id: 7 }] }));
  const previous = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    app.request(`https://example.test${String(input)}`, init)) as typeof fetch;
  try {
    let denied = false;
    try { await fetchPlaybooks(true, "wrong"); } catch { denied = true; }
    if (!denied) throw new Error("Unauthorized library access unexpectedly succeeded");
    if ((await fetchPlaybooks(true, "local-test")).length !== 1) throw new Error("Authorized list failed");
    if ((await fetchPlaybook(7, "local-test")).id !== 7) throw new Error("Authorized detail failed");
    if ((await fetchFamilyVersions("family", "local-test")).length !== 1) throw new Error("Authorized history failed");
  } finally {
    globalThis.fetch = previous;
  }
});
