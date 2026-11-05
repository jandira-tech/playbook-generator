# Agents working on playbook-from-doc

This val turns an agreement (paste) into an ACC-style contracts playbook draft.
It deliberately constrains the LLM: structured JSON only, free `gpt-5-nano`
via `std/openai`, user confirmation before SQLite save.

## Hard rules for any change

1. Model output must conform to `EXTRACT_SCHEMA` in `shared/catalog.ts`.
   Every property listed under `properties` must also appear in `required`
   (strict mode for `gpt-5-nano`).
2. Never call OpenAI without `response_format: { type: "json_schema", ... }`
   for extract. Help (`/api/help`) is the only free-text exception.
3. Never let the model emit free-form chat as the main product. If it drifts,
   fix the schema / prompt — don't add string cleaners.
4. Frontend: React **18.2.0** pinned (`?deps=react@18.2.0,react-dom@18.2.0`)
   and `/** @jsxImportSource https://esm.sh/react@18.2.0 */`.
5. SQLite: bump table name (`playbooks_v2`, …) when changing schema; no
   `ALTER TABLE`.
6. Storage: `https://esm.town/v/std/sqlite/main.ts` (val-scoped).
7. No secrets in code. Free `std/openai` only — no API key.

## Domain model (do not invent a different shape)

Each rule is an ACC negotiating-position row:

| Field | Meaning |
|---|---|
| `topic` | Term / clause name |
| `preferred` | Default / green position |
| `alternates[]` | Ordered fallbacks (rank 1 = best) |
| `avoid` | Positions to avoid / deal-breakers |
| `risk` | `green` \| `yellow` \| `red` |
| `escalate_when` | When / to whom to escalate |
| `sample_language` | Optional clause text |
| `raise_mode` | `proactive` \| `reactive` \| `either` |
| `source_quote` | Grounding in the user's document |

Intent gates depth: `full_playbook` | `format_only` | `single_clause` |
`counter_paper` | `unsure`.

## Varied customers — no SaaS default

Customers send loans, leases, NDAs, M&A, employment, SaaS, etc. The extract
prompt MUST:
1. Identify `agreement_type` + `party_vocabulary` from the document first.
2. Never invent SaaS/procurement framing for finance (or other) docs.
3. Use borrower/lender (or landlord/tenant, etc.) when that is the deal.
4. Treat empty `contract_type` as “infer only from text”, not as SaaS.

## Flow

`intent → context → document → processing → review → confirm → saved`

User must pass the "Are you sure?" gate on confirm before `POST /api/submit`.

## When the model misbehaves

Fix `shared/catalog.ts` prompts / schema first, then `backend/llm.ts` repair.
The frontend is a renderer of structured rules, not a chat UI.
