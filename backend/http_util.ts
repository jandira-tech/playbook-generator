// Small HTTP helpers for the Hono routes. Kept in its own module (no OpenAI /
// network imports) so it can be unit-tested in isolation.

/** The slice of a Hono context we need: just the JSON body reader. */
interface JsonReq {
  req: { json: () => Promise<unknown> };
}

/**
 * Safely read a JSON request body. `c.req.json()` throws on an empty or
 * malformed body — which would otherwise surface as a 500. Returns `null`
 * instead so callers can answer with a clean 400 `{ error: "invalid JSON body" }`.
 */
export async function readJsonBody<T = unknown>(c: JsonReq): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}
