# Turnspike interface: "Toll plaza"

Synthesised from the skill guidance (anthropics frontend-design and webapp-testing, impeccable, taste-skill, ui-ux-pro-max, emilkowalski/skills, interface-design, Vercel web interface guidelines and react-best-practices, shadcn theming). Every page follows this file.

## Subject
Turnspike is a toll gate for API requests: the agent reaches the gate, the gate quotes a price (HTTP 402), the agent pays within limits the owner posted, the barrier lifts, a ticket is issued. The visual language comes from that world: **tickets, barrier arms, posted tariff boards, lane markings, receipts**. Not from SaaS landing pages.

## Tokens (CSS variables, shadcn-style pairs, light and dark)
| Name | Light | Dark | Use |
|---|---|---|---|
| asphalt (foreground) | #1B1F24 | #E6EAE3 | text, ink |
| stock (background) | #E9EDE6 | #14171B | page, a pale grey-green ticket stock |
| ticket (card) | #FBFCF9 | #1C2025 | surfaces, tickets |
| lane (muted) | #DCE1D8 | #23282E | quiet fills, table stripes |
| graphite (muted-foreground) | #4A525A | #A3ACA4 | secondary text (>= 4.5:1 on stock and ticket) |
| line (border) | #C3CABF | #333A41 | borders |
| barrier (primary) | #F2B705 | #F2B705 | signal yellow, FILL ONLY, always with asphalt text |
| route (link/ring) | #1E4FB8 | #8AA9FF | links, focus ring |
| pass (success) | #136C3F | #5CC98E | passed, delivered |
| stop (danger) | #B4301D | #FF8A75 | refused, reverted |

Never: purple or blue gradients, cream + terracotta, near-black + acid green, gradient washes, glass panels.

## Type
- **Archivo** (variable, width axis) for everything human. Headlines use the expanded width (`font-stretch: 118%`), weight 760, tight leading, sentence case, like road signage. Body at normal width, 16 to 17px, line length 60 to 72ch.
- **IBM Plex Mono** only for things that are literally machine text: hashes, addresses, JSON, code, HTTP status lines. Not for decorative labels.
- Numbers that are compared use `tabular-nums`.
- No tracked-out all-caps eyebrows. A section starts with its headline. Small kickers, when needed, are sentence case at 14px in graphite.

## Shape and depth
- Radius: 6px for controls and tickets, 10px for large panels. Nothing pill-shaped except status dots.
- Depth: borders only, plus one shadow (`--shadow-ticket`) reserved for the floating ticket and dialogs.
- Spacing: 4px grid (4, 8, 12, 16, 24, 32, 48, 64, 96). Buttons 40px high (32 small, 48 large). Inputs 40px, 16px text on mobile.
- Signature marks, used sparingly and only where they mean something:
  - **Ticket edge**: perforated notches (`.ticket` utility) on things that are real receipts or challenges.
  - **Barrier stripe**: yellow/asphalt diagonal stripes (`.barrier-stripe`) only on the live gate and on refusals.
  - **Lane line**: dashed rule (`.lane-line`) to show a sequence (request to delivery).

## Layout
- Left-aligned, 12-column grid, max width 1200px, 20px gutters on mobile. Equal left and right content edges.
- No centred hero, no three identical cards, no icon tile above every heading, no cards inside cards.
- Dense where the reader is technical (tariff tables, ledgers), generous where they decide (hero, calls to action).

## Motion (one moment, otherwise quiet)
- The single orchestrated moment: the barrier arm on the home page settles down when the live 402 arrives, and lifts in the playground when a real payment is delivered.
- Easing `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out: cubic-bezier(0.77,0,0.175,1)`. Press 120ms scale(0.97). Overlays 220ms in, 160ms out. Hover only under `(hover:hover) and (pointer:fine)`. No scroll-reveal on sections. No `transition: all`.
- `prefers-reduced-motion`: keep opacity and colour, drop movement.

## Copy
Plain, active, specific. Buttons say the outcome ("Open the console", "Run the live demo", "Deposit 0.05 QUSDC"). No "→" glyphs, no "A · B · C" meta strings, no exclamation marks. Errors say what happened and what to do.

## States
Every data view has loading (skeleton after 200ms, matches layout), empty (with the next step), error (cause and recovery) and success. Status is never colour alone: always a word.

## Truthfulness
Only real data: live gateway responses, contract reads, and hashes from `evidence/`. No invented numbers, no testimonials, no logos of companies that do not use Turnspike.
