# Playbook design tokens

Adapted from `Contracts Playbook - Demo.html`, `demos/shared.css`, and
`colors_and_type.css` in the supplied Arthur Souza Rodrigues design archive.
The archive is a static mock with canned responses; this project retains its
model-backed workflow, not the mock's simulated actions or example output.

| Token | Value / use |
| --- | --- |
| Paper | `#FAFAF8` page background |
| Ink | `#0A0A0A` text, primary buttons, structural borders |
| Surface | `#FFFFFF` cards |
| Muted | `#6B6B6B` labels |
| Faint | `#E8E8E5` separators |
| Highlighter | `#FFD400` headline marker, focus shadow and accents |
| Body and display | Libre Franklin, with a system sans fallback |
| Labels and controls | Roboto Mono, with a system monospace fallback |
| Geometry | Square corners, one-pixel ink borders, no soft shadows |
| Content | 860px maximum flow width; responsive gutters |
| Motion | Subtle control movement; respects reduced-motion preference |

The font CSS loads from Google Fonts because Val Town projects store text files;
font fallbacks keep the app usable if the font service is unavailable. Existing
risk, validation and status colors are retained to preserve their meanings.
The implementation lives in `frontend/design.css` and the shared React shell.
