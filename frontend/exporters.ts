// Markdown + Word (.docx) export. The docx library is browser/runtime-heavy and
// stays out of shared/; the pure record→model mapper lives in shared/docx_model.ts.
import { buildDocxModel, type DocxModel, type DocxSection } from "../shared/docx_model.ts";
import type { PlaybookRecord } from "../shared/types.ts";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "https://esm.sh/docx@9.5.1?bundle";

function toMarkdown(record: PlaybookRecord): string {
  const md: string[] = [`# ${record.name}`, ""];
  const meta: string[] = [];
  if (record.brief.our_side && record.brief.our_side !== "unknown") {
    meta.push(`**Our side:** ${record.brief.our_side}`);
  }
  if (record.brief.contract_type) meta.push(`**Agreement:** ${record.brief.contract_type}`);
  if (record.brief.audience) meta.push(`**Audience:** ${record.brief.audience}`);
  if (meta.length) md.push(meta.join(" · "), "");
  if (record.summary) md.push(`> ${record.summary}`, "");
  for (const r of record.rules) {
    md.push(`## ${r.topic} — ${r.risk.toUpperCase()}`, "");
    md.push(`**Preferred:** ${r.preferred}`);
    if (r.alternates.length) {
      md.push("", "**Fallbacks (in order):**");
      r.alternates.forEach((a, i) => md.push(`${i + 1}. ${a.text}`));
    }
    if (r.avoid) md.push("", `**Avoid (no-go):** ${r.avoid}`);
    if (r.escalate_when) md.push("", `**Escalate deviations to:** ${r.escalate_when}`);
    if (r.raise_mode && r.raise_mode !== "either") {
      md.push("", `**Raise:** ${r.raise_mode}`);
    }
    if (r.sample_language) {
      md.push("", "**Sample language:**", "", "```", r.sample_language, "```");
    }
    md.push("");
  }
  md.push("---", "", "_Draft generated with AI assistance — review before relying on it._");
  return md.join("\n");
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Firefox requires the anchor to be in the document for the click to fire;
  // revoking synchronously can cancel the download, so defer it a tick.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadMarkdown(record: PlaybookRecord) {
  const blob = new Blob([toMarkdown(record)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${slugName(record.name)}.md`);
}

function slugName(name: string): string {
  return (name.replace(/[^a-z0-9 _-]/gi, "").trim() || "playbook")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

// ---------- Word (.docx) export ----------
// The record → intermediate model lives in shared/docx_model.ts (unit-tested,
// runtime-free). Here we walk that model and emit `docx` objects. The bytes are
// covered by the agent-browser E2E, not by Deno tests.

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function labelledParagraph(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 40 },
    children: [
      new TextRun({ text: `${label} `, bold: true }),
      new TextRun({ text: value }),
    ],
  });
}

function sectionParagraphs(s: DocxSection): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  // Topic heading + RYG risk chip as a shaded table cell.
  out.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: "none", size: 0, color: "FFFFFF" },
        bottom: { style: "none", size: 0, color: "FFFFFF" },
        left: { style: "none", size: 0, color: "FFFFFF" },
        right: { style: "none", size: 0, color: "FFFFFF" },
        insideHorizontal: { style: "none", size: 0, color: "FFFFFF" },
        insideVertical: { style: "none", size: 0, color: "FFFFFF" },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 78, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  spacing: { before: 200, after: 40 },
                  children: [new TextRun({ text: s.topic, bold: true })],
                }),
              ],
            }),
            new TableCell({
              width: { size: 22, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, color: "auto", fill: s.riskShade },
              verticalAlign: "center",
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: `${s.riskLabel} RISK`, bold: true, size: 18 }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  );

  out.push(labelledParagraph("Preferred:", s.preferred));

  if (s.fallbacks.length) {
    out.push(
      new Paragraph({
        spacing: { before: 80, after: 20 },
        children: [new TextRun({ text: "Fallback ladder (best first):", bold: true })],
      }),
    );
    s.fallbacks.forEach((text, i) => {
      out.push(
        new Paragraph({
          spacing: { after: 20 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: `${i + 1}. `, bold: true }),
            new TextRun({ text }),
          ],
        }),
      );
    });
  }

  if (s.avoid) out.push(labelledParagraph("Avoid (no-go):", s.avoid));
  if (s.escalate) out.push(labelledParagraph("Escalate deviations to:", s.escalate));
  if (s.raiseMode) out.push(labelledParagraph("Raise:", s.raiseMode));

  if (s.sample) {
    out.push(
      new Paragraph({
        spacing: { before: 80, after: 20 },
        children: [new TextRun({ text: "Sample language:", bold: true })],
      }),
    );
    out.push(
      new Paragraph({
        spacing: { after: 80 },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: "F1F5F9" },
        children: [new TextRun({ text: s.sample, font: "Courier New", size: 20 })],
      }),
    );
  }

  return out;
}

function docxModelToDocument(model: DocxModel): Document {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: model.title })] }),
  ];
  if (model.meta) {
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: model.meta, italics: true, color: "64748B" })],
      }),
    );
  }
  if (model.summary) {
    children.push(
      new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: model.summary })] }),
    );
  }
  for (const s of model.sections) children.push(...sectionParagraphs(s));

  children.push(
    new Paragraph({
      spacing: { before: 400 },
      border: { top: { style: "single", size: 6, color: "CBD5E1", space: 8 } },
      children: [new TextRun({ text: model.footer, italics: true, color: "64748B", size: 18 })],
    }),
  );

  return new Document({ sections: [{ children }] });
}

async function downloadDocx(record: PlaybookRecord) {
  const doc = docxModelToDocument(buildDocxModel(record));
  const blob = await Packer.toBlob(doc);
  const typed = blob.type ? blob : new Blob([blob], { type: DOCX_MIME });
  const url = URL.createObjectURL(typed);
  triggerDownload(url, `${slugName(record.name)}.docx`);
}

export { downloadDocx, downloadMarkdown, slugName, toMarkdown };
