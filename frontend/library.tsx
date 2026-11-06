/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useEffect, useState } from "https://esm.sh/react@18.2.0?deps=react@18.2.0";
import { INTENT_LABEL } from "../shared/catalog.ts";
import { relativeDate, summarizeDiff, versionLabel } from "../shared/library.ts";
import { fetchDemoPlaybook, fetchFamilyVersions, fetchPlaybook, fetchPlaybooks, riskColor } from "./session.ts";
import { downloadDocx, downloadMarkdown, toMarkdown } from "./exporters.ts";
import { copyText } from "./clipboard.ts";
import { Card, ErrorBox, GhostButton, PrimaryButton } from "./ui.tsx";
import type {
  FamilyVersionEntry,
  PlaybookRecord,
  PlaybookRow,
  PlaybookRule,
  PlaybookSummary,
} from "../shared/types.ts";

// The library is a self-contained overlay rather than a Shell stage: it does not
// belong in the linear intent→…→confirm progress nav, and keeping it out of the
// persisted `stage` avoids reloading into a read-only view. App toggles it.

type View =
  | { kind: "list" }
  | { kind: "detail"; id: number }
  | { kind: "history"; familyId: string; name: string };

function LibraryScreen({
  token,
  onTokenChange,
  onClose,
  onDuplicate,
  onReviewCounter,
}: {
  token: string;
  onTokenChange: (token: string) => void;
  onClose: () => void;
  onDuplicate: (record: PlaybookRecord, familyId: string, version: number) => void;
  onReviewCounter: (record: PlaybookRecord) => void;
}) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [enteredToken, setEnteredToken] = useState("");
  const [mode, setMode] = useState<"loading" | "demo" | "stored" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/mode", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error("Mode unavailable"); return r.json(); })
      .then((m: { demo?: boolean }) => setMode(m.demo === true ? "demo" : "stored"))
      .catch(() => { if (!controller.signal.aborted) setMode("error"); });
    return () => controller.abort();
  }, []);

  return (
    <div className="playbook-theme max-w-3xl mx-auto px-4 py-8" data-testid="library-screen">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1">
            Contracts playbook
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            My playbooks
          </h1>
          <p className="text-slate-600 mt-2 text-sm leading-relaxed max-w-xl">
            {mode === "demo"
              ? "A sample playbook stored in this val’s SQLite database. Open it to read the positions. Playbooks you confirm are stored too, and are not listed here."
              : "Every playbook you have saved, latest version first. Open one to read it, export it, duplicate it into a new draft, or browse its history."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="library-close"
          className="text-xs text-slate-500 hover:text-slate-900 underline shrink-0 mt-1"
        >
          Close
        </button>
      </header>

      {mode === "loading" && <p role="status">Checking library availability…</p>}
      {mode === "error" && <ErrorBox message="Could not check library availability. Close and reopen the library to retry." />}
      {mode === "demo" && (
        <DemoLibrary onDuplicate={onDuplicate} onReviewCounter={onReviewCounter} />
      )}
      {mode === "stored" && !token && <Card>
        <form onSubmit={(e) => { e.preventDefault(); if (enteredToken.trim()) { onTokenChange(enteredToken.trim()); setEnteredToken(""); } }}>
          <label htmlFor="library-token" className="block text-sm font-semibold mb-2">Admin access token</label>
          <p className="text-sm text-slate-600 mb-3">Enter the token configured for this deployment. It stays in this page’s memory and is cleared when you reload.</p>
          <input id="library-token" type="password" autoComplete="off" value={enteredToken} onChange={(e) => setEnteredToken(e.target.value)} className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-3" />
          <PrimaryButton type="submit" disabled={!enteredToken.trim()}>Open library</PrimaryButton>
        </form>
      </Card>}
      {mode === "stored" && token && <div className="mb-4"><button type="button" onClick={() => { onTokenChange(""); setView({ kind: "list" }); }} className="text-xs underline">Forget access token</button></div>}
      {mode === "stored" && token && view.kind === "list" && (
        <LibraryList token={token}
          onOpen={(id) => setView({ kind: "detail", id })}
        />
      )}
      {mode === "stored" && token && view.kind === "detail" && (
        <PlaybookDetail
          token={token}
          id={view.id}
          onBack={() => setView({ kind: "list" })}
          onHistory={(familyId, name) => setView({ kind: "history", familyId, name })}
          onDuplicate={onDuplicate}
          onReviewCounter={onReviewCounter}
        />
      )}
      {mode === "stored" && token && view.kind === "history" && (
        <VersionHistory
          token={token}
          familyId={view.familyId}
          name={view.name}
          onBack={() => setView({ kind: "list" })}
          onOpenVersion={(id) => setView({ kind: "detail", id })}
        />
      )}
    </div>
  );
}

// ---------- List ----------

function LibraryList({ onOpen, token }: { onOpen: (id: number) => void; token: string }) {
  const [hideVault, setHideVault] = useState(false);
  const [rows, setRows] = useState<PlaybookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    fetchPlaybooks(!hideVault, token)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError((e instanceof Error ? e.message : String(e))));
    return () => {
      live = false;
    };
  }, [hideVault, token]);

  return (
    <div className="space-y-4" data-testid="library-list">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-600" data-testid="library-count">
          {rows ? `${rows.length} playbook${rows.length === 1 ? "" : "s"}` : error ? "Unable to load" : "Loading…"}
        </span>
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideVault}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHideVault(e.target.checked)}
            aria-label="Hide private-vault playbooks"
            data-testid="library-hide-vault"
            className="h-4 w-4 accent-slate-900"
          />
          Hide private-vault
        </label>
      </div>

      {error && <ErrorBox message={error} />}

      {rows && rows.length === 0 && !error && (
        <Card className="text-center py-10">
          <p className="text-sm text-slate-500" data-testid="library-empty">
            No playbooks yet. Save one from the flow and it will show up here.
          </p>
        </Card>
      )}

      {rows?.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p.id)}
          data-testid="library-card"
          data-family={p.family_id}
          className="w-full text-left"
        >
          <Card className="hover:border-slate-400 transition">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900 text-base">{p.name}</h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                    {versionLabel(p.version)}
                  </span>
                  {p.vault_only && (
                    <span
                      data-testid="vault-badge"
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300"
                    >
                      🔒 Vault
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {p.rule_count} rule{p.rule_count === 1 ? "" : "s"}
                  {p.contract_type ? ` · ${p.contract_type}` : ""}
                  {p.intent && INTENT_LABEL[p.intent as keyof typeof INTENT_LABEL]
                    ? ` · ${INTENT_LABEL[p.intent as keyof typeof INTENT_LABEL]}`
                    : ""}
                </p>
              </div>
              <span className="text-[11px] text-slate-400 shrink-0">
                {relativeDate(p.created_at)}
              </span>
            </div>
          </Card>
        </button>
      ))}
    </div>
  );
}

// ---------- Detail (read-only) ----------

function DemoLibrary({
  onDuplicate,
  onReviewCounter,
}: {
  onDuplicate: (record: PlaybookRecord, familyId: string, version: number) => void;
  onReviewCounter: (record: PlaybookRecord) => void;
}) {
  const [row, setRow] = useState<PlaybookRow | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchDemoPlaybook()
      .then((next) => { if (live) setRow(next); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!row) return <p role="status">Loading the sample playbook…</p>;
  if (open) {
    return (
      <PlaybookDetail
        token=""
        id={row.id}
        provided={row}
        onBack={() => setOpen(false)}
        onDuplicate={onDuplicate}
        onReviewCounter={onReviewCounter}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      data-testid="demo-playbook-card"
      className="w-full text-left"
    >
      <Card className="hover:border-slate-400 transition">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-900 text-base">{row.payload.name}</h3>
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
            Sample
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {row.rule_count} rules · {row.contract_type ?? "playbook"} · stored in SQLite
        </p>
      </Card>
    </button>
  );
}

function PlaybookDetail({
  token,
  id,
  provided,
  onBack,
  onHistory,
  onDuplicate,
  onReviewCounter,
}: {
  token: string;
  id: number;
  provided?: PlaybookRow;
  onBack: () => void;
  onHistory?: (familyId: string, name: string) => void;
  onDuplicate: (record: PlaybookRecord, familyId: string, version: number) => void;
  onReviewCounter: (record: PlaybookRecord) => void;
}) {
  const [row, setRow] = useState<PlaybookRow | null>(provided ?? null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (provided) {
      setRow(provided);
      return;
    }
    let live = true;
    setRow(null);
    setError(null);
    fetchPlaybook(id, token)
      .then((r) => live && setRow(r))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [id, token, provided]);

  async function copyMarkdown(record: PlaybookRecord) {
    if (await copyText(toMarkdown(record))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorBox message={error} />
        <GhostButton onClick={onBack}>Back to library</GhostButton>
      </div>
    );
  }
  if (!row) {
    return (
      <Card className="text-center py-10">
        <p className="text-sm text-slate-500">Loading playbook…</p>
      </Card>
    );
  }

  const record = row.payload;
  const rules = Array.isArray(record.rules) ? record.rules : [];

  return (
    <div className="space-y-4" data-testid="library-detail">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-2xl font-semibold text-slate-900">{record.name}</h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                {versionLabel(row.version)}
              </span>
              {row.vault_only && (
                <span
                  data-testid="vault-badge"
                  className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300"
                >
                  🔒 Vault
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Playbook #{row.id} · {rules.length} rule{rules.length === 1 ? "" : "s"}
              {record.brief?.contract_type ? ` · ${record.brief.contract_type}` : ""}
              {record.brief?.our_side && record.brief.our_side !== "unknown"
                ? ` · our side: ${record.brief.our_side}`
                : ""}
            </p>
          </div>
          <GhostButton onClick={onBack}>Back to library</GhostButton>
        </div>

        {record.summary && (
          <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Summary
            </div>
            {record.summary}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <GhostButton onClick={() => downloadMarkdown(record)}>Download .md</GhostButton>
          <GhostButton onClick={() => downloadDocx(record)}>Download .docx</GhostButton>
          <GhostButton onClick={() => copyMarkdown(record)}>
            {copied ? "Copied ✓" : "Copy Markdown"}
          </GhostButton>
          {onHistory && (
            <GhostButton onClick={() => onHistory(row.family_id, record.name)}>
              History
            </GhostButton>
          )}
          <GhostButton onClick={() => onDuplicate(record, row.family_id, row.version)}>
            Duplicate &amp; edit
          </GhostButton>
          <PrimaryButton onClick={() => onReviewCounter(record)}>
            Review a counterparty draft
          </PrimaryButton>
        </div>
      </Card>

      {rules.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500 text-center py-6">
            This playbook has no rules.
          </p>
        </Card>
      ) : (
        rules.map((r, i) => <ReadOnlyRuleCard key={r.id || i} rule={r} priority={i + 1} />)
      )}
    </div>
  );
}

/** Read-only rendering of a saved rule (mirrors the review card, no controls). */
function ReadOnlyRuleCard({ rule, priority }: { rule: PlaybookRule; priority: number }) {
  return (
    <div data-testid="detail-rule">
    <Card>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
          #{priority}
        </span>
        <h3 className="font-semibold text-slate-900 text-base">
          {rule.topic || "Untitled topic"}
        </h3>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${riskColor(rule.risk)}`}
        >
          {rule.risk}
        </span>
      </div>
      {rule.rationale && (
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">{rule.rationale}</p>
      )}

      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 mb-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-slate-600">
          Preferred position
        </div>
        <div className="text-sm font-medium text-slate-900 whitespace-pre-wrap">
          {rule.preferred || <span className="text-slate-400 font-normal">—</span>}
        </div>
      </div>

      {rule.alternates?.length > 0 && (
        <div className="mb-3 rounded border border-slate-100 bg-slate-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Fallbacks (in order)
          </div>
          <ol className="list-decimal list-inside text-xs text-slate-600 space-y-0.5">
            {rule.alternates.map((a) => <li key={a.rank + a.text.slice(0, 24)}>{a.text}</li>)}
          </ol>
        </div>
      )}

      {rule.avoid && (
        <div className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 mb-1">
            Avoid (no-go)
          </div>
          <p className="text-sm text-rose-950 bg-rose-50/40 border border-rose-200 rounded px-2 py-1.5 whitespace-pre-wrap">
            {rule.avoid}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {rule.escalate_when && (
          <span>
            <span className="font-semibold text-slate-500">Escalate to:</span> {rule.escalate_when}
          </span>
        )}
        {rule.raise_mode && rule.raise_mode !== "either" && (
          <span>
            <span className="font-semibold text-slate-500">Raise:</span> {rule.raise_mode}
          </span>
        )}
      </div>

      {rule.sample_language && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Sample language
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-slate-700">
            {rule.sample_language}
          </pre>
        </div>
      )}
    </Card>
    </div>
  );
}

// ---------- Version history ----------

function VersionHistory({
  token,
  familyId,
  name,
  onBack,
  onOpenVersion,
}: {
  token: string;
  familyId: string;
  name: string;
  onBack: () => void;
  onOpenVersion: (id: number) => void;
}) {
  const [versions, setVersions] = useState<FamilyVersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setVersions(null);
    setError(null);
    fetchFamilyVersions(familyId, token)
      .then((v) => live && setVersions(v))
      .catch((e) => live && setError((e instanceof Error ? e.message : String(e))));
    return () => {
      live = false;
    };
  }, [familyId, token]);

  return (
    <div className="space-y-4" data-testid="library-history">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1">
              Version history
            </div>
            <h2 className="text-2xl font-semibold text-slate-900">{name}</h2>
          </div>
          <GhostButton onClick={onBack}>Back to library</GhostButton>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}
      {!versions && !error && (
        <Card className="text-center py-8">
          <p className="text-sm text-slate-500">Loading history…</p>
        </Card>
      )}

      {versions?.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onOpenVersion(v.id)}
          data-testid="history-version"
          data-version={v.version}
          className="w-full text-left"
        >
          <Card className="hover:border-slate-400 transition">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-900 text-white">
                  {versionLabel(v.version)}
                </span>
                <span className="text-sm text-slate-700">
                  {v.rule_count} rule{v.rule_count === 1 ? "" : "s"}
                </span>
                {v.vault_only && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                    🔒 Vault
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-400">{relativeDate(v.created_at)}</span>
            </div>
            <p
              className="text-xs mt-2 font-medium text-slate-600"
              data-testid="history-diff"
            >
              {summarizeDiff(v.diff_from_previous)}
            </p>
          </Card>
        </button>
      ))}
    </div>
  );
}

export { LibraryScreen };
