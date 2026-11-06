# Playbook from Agreement

[Open the demo](https://arthrod--cdf728ae-d937-11f1-a239-1607ee4eb77e.web.val.run/) · [Val Town project](https://www.val.town/x/arthrod/playbook-generator-jandira)

A Val Town demo that turns an agreement into a structured contracts playbook: preferred positions, ordered alternatives, positions to avoid, risk, escalation guidance, and source quotations. A person reviews the draft and explicitly confirms before submitting. The model's output is a draft, not a substitute for legal review.

Source: [arthrod/playbook-from-doc](https://www.val.town/x/arthrod/playbook-from-doc). See [DESIGN.md](DESIGN.md) for the design tokens extracted from the source UI.

## Try the workflow

1. Choose full playbook, format only, single clause, counterparty paper, or unsure. Single clause requires a focus.
2. Name the playbook and paste an agreement, use the sample NDA, or select a file. `.docx` and text-based `.pdf` files are parsed in the browser; `.txt`, `.md`, `.markdown`, `.rtf`, and `.csv` are read as text. Scanned or protected PDFs may require pasting text instead. File limit is 15 MB.
3. Optionally enable pattern-based redaction, then review the AI-proposed context and supply your own answers.
4. Generate and review positions; select alternatives or write edits, and inspect source quotes and risk labels.
5. Confirm the final draft. Export Markdown or Word from the saved screen. When configured, the library provides versions, diffs, duplication and counterparty-draft review.

The model uses the agreement's own party vocabulary; `our_side` accepts custom roles. Five intents control the depth of the output. The app also has inline AI help. The counterparty review compares another draft to a selected playbook and does not itself save a record.

## Data and demo mode

Confirmed playbooks are stored in the val-scoped SQLite database (`playbooks_v2`), including on the public demo. The browser also keeps the in-progress draft in `localStorage`. Model requests send text to Val Town's OpenAI integration. Clear browser site data to remove the local draft; that does not delete the SQLite row.

`GET /api/demo-playbook` returns one fictional sample, inserted once under the family id `demo-sample-nda`. The public library opens that sample and does not list other rows. A duplicate of the sample starts a new family, so a visitor cannot append a version onto the sample.

With `ADMIN_TOKEN` unset, every other stored-record GET returns 503. Setting a strong `ADMIN_TOKEN` opens the full library. Those routes require `Authorization: Bearer <ADMIN_TOKEN>` and fail closed when the bearer does not match. The browser library asks for the token, keeps it only in page memory, and lets you forget it; reloading clears it. Submissions themselves are not authenticated. Do not treat this demo as a multi-user private document service.

File binaries are parsed in the browser, but extracted text is sent to the server for AI processing. The optional redaction masks recognized patterns in document text before elicitation and extraction, restores matched placeholders for display, and is best effort: it can miss sensitive data. Brief fields and other inputs are separate from the redacted document. Counterparty review and help are separate model calls. Avoid using confidential documents unless your deployment and data handling are appropriate for them.

Model input is truncated (about 14,000 characters); stored source excerpts are limited to 8,000 characters unless discarded. This can omit relevant clauses. Model traffic is rate-limited in memory per isolate, so limits are approximate across multiple isolates. Val Town model quota is shared with other vals on the account.

## Run and deploy

Prerequisites: a Val Town account, [vt CLI](https://docs.val.town/guides/vt/), and Deno for local checks. The frontend imports React and other libraries from CDNs; the server uses Hono, Val Town's OpenAI proxy, and val-scoped SQLite. No OpenAI API key is required for the configured `gpt-5-nano` model.

```sh
# Create your own independent copy on Val Town, then clone it locally:
vt remix arthrod/playbook-from-doc my-playbook ./my-playbook
cd my-playbook
# Copy this repository's source into that checkout, preserving its .vt state.
vt push
```

Alternatively, use `vt create` for a fresh val and copy the source into that checkout. **Check `vt status` before pushing**: `.vt/state.json` identifies the target val and is intentionally excluded from Git. Do not push a source clone without first changing the target; doing so would update the original. Configure `ADMIN_TOKEN` in the new val's environment only if you want the full library to be readable; never commit it. Confirmed playbooks are stored either way. Each val has its own database, so cloning code does not copy saved playbooks. The sample row is created on the first request to `/api/demo-playbook`.

Run the offline checks with `deno task test`. They exercise redaction and elicitation restoration, file-type dispatch, quote verification, version selection, demo mode, rate-limit windows, and authenticated library request handling; they do not call a model or verify a deployed browser flow. Run `vt status` to inspect local changes and `vt push` to deploy the current checkout.

## Structure and API

| Path | Responsibility |
| --- | --- |
| `backend/index.http.tsx` | HTTP entry point, request validation, static assets and routes |
| `backend/llm.ts`, `shared/catalog.ts` | Structured model calls, prompts and schema |
| `backend/db.ts`, `backend/auth.ts` | SQLite version families and read authorization |
| `frontend/` | React flow, document parsing, library, review and exports |
| `shared/` | Types, ingestion, redaction, quote verification and versioning |

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/mode` | Whether the full library is closed (`demo: true` when `ADMIN_TOKEN` is unset) |
| GET | `/api/demo-playbook` | The sample playbook stored in SQLite. Public. |
| POST | `/api/elicit-brief` | Suggest context from `brief` and `document_text` |
| POST | `/api/extract` | Draft structured rules from `brief` and `document_text` |
| POST | `/api/review-counter` | Compare `counterparty_text` with `rules` |
| POST | `/api/help` | Explain a `question` with optional `brief` |
| POST | `/api/submit` | Validate and optionally save a `playbook`, with optional `family_id` |
| GET | `/api/playbooks`, `/api/playbooks/:id`, `/api/playbooks/family/:familyId` | Token-protected library and version history; `?vault=exclude` filters the list |

The strict extract schema is in `shared/catalog.ts`. Keep React and ReactDOM versions aligned, use relative imports within the val, and preserve the confirmation gate. See [AGENTS.md](AGENTS.md) for the source project's domain and development constraints.

## Design reference

The interface adapts the supplied design archive’s Contracts Playbook demo: paper, ink, square panels and a yellow highlighter. See `DESIGN.md` for tokens. The archive’s example is a scripted mock; this version connects the controls to the real elicitation, extraction, review and demo-save workflow described above. Fonts load from Google Fonts, with system fallbacks.
