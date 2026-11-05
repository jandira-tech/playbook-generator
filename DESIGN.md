# Design tokens and conventions

Extracted from the cloned UI, primarily `frontend/index.html`, `frontend/ui.tsx`, and the step components. These describe the existing appearance; utility colors are supplied by Twind's Tailwind-style palette, not a separate CSS token file.

| Role | Source value |
| --- | --- |
| Page background | vertical gradient `#f7f4ef` → `#eef2f7` |
| Surface | white; slate-50 for secondary panels |
| Primary text / action | slate-900, action hover slate-800, action text white |
| Secondary text | slate-500 to slate-700 |
| Borders | slate-200 / slate-300 |
| Selection / information | indigo-50 through indigo-900; sky for informational panels |
| Risk / status | emerald (positive), amber (caution), rose (negative) |
| Font | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`; monospace for agreement text and clause excerpts |
| Heading | 3xl semibold with tight tracking for the page title; 2xl / xl for sections |
| Labels | 10–12 px, semibold, uppercase, wide tracking |
| Page width / spacing | `max-w-3xl` (48rem), horizontal padding 1rem, vertical padding 2rem |
| Cards | white, slate-200 border, small shadow, `rounded-lg`, 1.5rem padding; 2rem at `sm` |
| Controls | small rounded corners; primary button slate-900 with white uppercase label; chips use full rounding |

Components also use responsive utility classes. Color names represent Twind utility tokens and may depend on the remote CDN implementation.
