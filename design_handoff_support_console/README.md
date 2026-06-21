# Handoff: Molly & Stitch Customer Support Console

## Overview
A single-operator customer support console for the e-commerce brand Molly & Stitch. It connects to a Gmail support inbox and a Shopify store. AI reads each incoming email, decides whether it's a genuine support request, classifies it, drafts a reply in the brand's voice, and presents it to a human for review. The human approves, edits, or rejects — and **only an explicit approval sends the reply**. This is an internal operations tool used by one person at a time. The chrome is calm and neutral; the brand personality lives in the emails being sent, not the tool.

The product is organized around six destinations: **Inbox**, **Approvals**, **Knowledge Base**, **Insights**, **Settings**, plus the **Thread / Draft Review** surface (reached from the Inbox). The Thread/Draft Review screen is the heart of the app and where the most design effort lives.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, **not production code to copy directly**. The HTML is written as a "Design Component" (a single streaming `.dc.html` file with an embedded template + a `Component` logic class) and depends on a local `support.js` runtime; this structure is a prototyping convenience and should **not** be reproduced in the target codebase.

The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, SwiftUI, native, etc.) using its established components, patterns, routing, and data layer. If no front-end environment exists yet, choose the most appropriate framework for the project and implement the designs there. Wire the screens to the real Gmail + Shopify integrations and AI drafting backend; the prototype uses hard-coded seed data.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, component states, and interactions are all specified below and in the HTML. Recreate the UI pixel-perfectly using the codebase's existing libraries and patterns, substituting the codebase's own primitives (buttons, badges, cards) where they already exist — but match the exact tokens, layout, and copy documented here.

---

## Design Tokens

The prototype is themeable via CSS custom properties with a light (default) and dark theme. **Light mode is primary; dark mode is a supported secondary.** All values below are the light-theme values, with dark-theme values in parentheses where they differ.

### Color — neutrals & surfaces (warm-toned)
| Token | Light | Dark | Usage |
|---|---|---|---|
| `--bg` | `#EFEDE7` | `#171614` | App background |
| `--surface` | `#FFFFFF` | `#211F1C` | Cards, rows, panels |
| `--surface-2` | `#F7F5F1` | `#1C1B18` | Sidebar, subtle panels, inputs |
| `--surface-3` | `#FBFAF8` | `#1F1E1A` | Composer / draft-side background |
| `--hover` | `#F1EFEA` | `#2A2825` | Hover fills, placeholder stripes |
| `--border` | `#E7E3DC` | `#332F2A` | Primary borders |
| `--border-2` | `#EDEAE4` | `#2C2A26` | Inner dividers / row separators |
| `--shadow` | `0 1px 2px rgba(40,38,34,.05)` | `0 1px 2px rgba(0,0,0,.3)` | Card shadow |
| `--text` | `#23211E` | `#ECE8E1` | Primary text |
| `--text-2` | `#56524C` | `#AEA9A0` | Secondary text |
| `--text-3` | `#928D85` | `#7C776F` | Tertiary / meta text |

### Color — accent (forest green; reserved for the send action and key affordances)
| Token | Light | Dark |
|---|---|---|
| `--accent` | `#2F5D50` | `#4F9E84` |
| `--accent-press` | `#274F44` | `#5CAE93` |
| `--accent-fg` | `#FFFFFF` | `#0E1B16` |
| `--accent-soft-bg` | `#E3EFE8` | `#1C342B` |
| `--accent-soft-fg` | `#2C6A52` | `#6FBC9E` |

> **Accent discipline:** forest green is used **only** for the Approve & Send button, the active "Needs Review" filter, the send-confirm dialog, "connected" indicators, sent/approved checkmarks, progress bars, and the active-nav unread counts. It is never decorative.

### Color — category tags (5, color-coded but restrained; bg / fg pairs)
| Category | bg (light) | fg (light) | bg (dark) | fg (dark) |
|---|---|---|---|---|
| Exchange | `#F3E8DF` | `#8A4B26` | `#382820` | `#D49A70` |
| Shipping Status | `#E4ECF4` | `#2C5680` | `#1E2E3B` | `#82B0DA` |
| Sizing | `#EDE7F3` | `#6B4A86` | `#2B2438` | `#B59AD4` |
| Discount | `#F2ECDA` | `#85661F` | `#33301C` | `#CBAF68` |
| Other | `#ECE9E2` | `#5C574F` | `#2A2824` | `#A39E94` |

### Color — status badges (bg / fg pairs)
| Status | bg (light) | fg (light) | Notes |
|---|---|---|---|
| New | `#E7EEF5` | `#2C5680` | |
| Drafting | `#F2ECDA` | `#85661F` | Has a pulsing 6px dot (`@keyframes pulse`, 1.3s ease-in-out infinite) |
| Needs Review | `#E3EFE8` | `#2C6A52` | The daily-driver status |
| Sent | `#EAE7E0` | `#6B675F` | Muted/neutral |
| Dismissed | `#EDEAE4` | `#928D85` | Muted |

Dark equivalents: New `#1E2E3B`/`#82B0DA`, Drafting `#33301C`/`#CBAF68`, Needs Review `#1C342B`/`#6FBC9E`, Sent `#2A2824`/`#9A958C`, Dismissed `#262420`/`#7C776F`.

### Color — confidence indicator (calm, not alarmist)
| Level | Color (light) | Color (dark) | Dots filled (of 3) |
|---|---|---|---|
| High | `--conf-high` `#2F7D5E` | `#5AA886` | 3 |
| Medium | `--conf-med` `#B07D2A` | `#C09A4E` | 2 |
| Low | `--conf-low` `#A86A3A` | `#C0895A` | 1 |
| (empty dot) | `--dot-off` `#DAD5CC` | `#3A372F` | — |

In list rows, confidence is a single colored 7px dot + label (e.g. "High"). On the review header it's three 6px dots (filled per level) + label.

### Color — "Suggested action" callout (warm amber)
| Token | Light | Dark |
|---|---|---|
| `--warn-bg` | `#FBF4E7` | `#2E2814` |
| `--warn-bd` | `#EAD9B5` | `#4A3F22` |
| `--warn-fg` (label/icon) | `#8A6A2A` | `#CBAF68` |
| `--warn-fg2` (note) | `#9A8A63` | `#9A8A63` |
| `--warn-tx` (body) | `#5C4D2E` | `#D8C79A` |

### Typography
- **Sans (UI):** `Source Sans 3` (Google Fonts), weights 400/500/600/700, with `system-ui, sans-serif` fallback. `-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility`.
- **Mono:** `IBM Plex Mono` (Google Fonts), weights 400/500, used for **order numbers, email addresses, tracking codes, keyboard-shortcut chips, counts, and timestamps in the audit log**.
- Type scale in use (px):
  - Page H1: 21, weight 700, letter-spacing −0.015em
  - Section/card title: 15.5, weight 700
  - Row primary (name/subject): 14–14.5, weight 600 (700 when unread)
  - Body / email message: 15.5–16, line-height 1.65–1.75
  - Draft composer text: 14.5, line-height 1.62
  - Secondary / snippet: 13–13.5
  - Meta / labels: 11–12.5
  - Eyebrow labels (mono, uppercase): 11, letter-spacing 0.07–0.08em
  - Big metric (Insights): 26, weight 700, letter-spacing −0.02em

### Spacing, radius, shadow
- Spacing is an informal 3/4-based rhythm; common paddings: rows `15px 18px`, cards `20px 22px`, panels `13–16px`.
- Border radius: pills/badges `999px`; buttons & inputs `8–9px`; small icon buttons `7px`; cards `11–16px` (rows list container 13, cards 14, modal 16); avatars `50%`.
- Card shadow: `var(--shadow)`; modal: `0 24px 60px rgba(20,18,14,.3)`; floating bars/toasts: `0 12px 30px rgba(20,18,14,.28)`.
- Sidebar width: **248px**. Top bar height: **60px**. Review header height: **60px**. Context rail width: **392px**.

### Keyframes
- `spin` (0.7s linear infinite) — sync + regenerate spinners
- `pulse` (1.3s ease-in-out infinite, opacity 1→.35) — Drafting status dot
- `fadein` (0.14s) — modal backdrop
- `popin` (0.18s cubic-bezier(.2,.7,.3,1)) — confirm dialog
- `toastin` (0.22s cubic-bezier(.2,.7,.3,1)) — toast slide-up

---

## App Shell (persistent on every screen)

**Layout:** horizontal flex, full viewport height. `[ Sidebar 248px ][ Main flex:1 ]`. Main is a column: `[ Top bar 60px ][ Content flex:1, scrolls internally ]`.

### Sidebar (`--surface-2`, right border `--border`)
- **Brand block** (60px tall, bottom border): 30×30 rounded-8 accent square with white "M", then "Molly & Stitch" (14.5px/700, nowrap) over "Support Console" (11.5px/500, `--text-3`).
- **Nav** (label "WORKSPACE", 11px/600 uppercase tracked, `--text-3`): 5 items, each a full-width left-aligned button, 9px/11px padding, radius 9px, 11px gap, 18px icon + label + optional count pill.
  - **Active item:** background `--surface`, text `--text`. Inactive: transparent, text `--text-2`.
  - Items: **Inbox** (count = needs-review count), **Approvals** (count = needs-review count), **Knowledge Base**, **Insights**, **Settings**. Inbox is treated active when on the Review screen too.
  - Count pill: mono 11.5px/600, radius 999px; active `--accent-soft-bg`/`--accent-soft-fg`, else `--surface`/`--text-3`.
- **Account block** (bottom, top border): 30×30 round avatar "MA", "Maya Alvarez" / "Owner", trailing 7px green status dot.

### Top bar (`--surface`, bottom border)
- **Search field** (left, max-width 440px, 38px tall, `--surface-2`, radius 9px): search icon + placeholder "Search threads, customers, orders…" + mono "⌘K" chip on the right.
- **Right cluster:** **Sync** button (border, 34px, refresh icon — swaps to a spinning loader + "Syncing…" while active), **connected-account** chip (green dot + "support@mollystitch.com"), **theme toggle** (34×34 icon button — moon in light, sun in dark).

---

## Screens / Views

### 1. Inbox
**Purpose:** daily entry point. Triage what's real vs noise; jump into a thread that needs review.

**Layout:** column. Fixed toolbar block (padding `20px 28px 0`) above a scrolling list (padding `16px 28px 28px`).
- **Header row:** H1 "Inbox" + subtitle "`N` need review · `M` customer threads today". When syncing, a right-aligned pill (accent-soft) with a spinner + "Syncing Gmail & Shopify…".
- **Customer-vs-noise segmented control** (the primary triage gate): a 2-segment pill group in `--surface-2`/border/radius 10, 3px padding. Segments: **"Customer requests"** (default) and **"Filtered out"**, each with a count pill. Active segment = `--surface` fill + shadow + `--text`; inactive = transparent + `--text-3`.
- **Status filter chips** (only on Customer requests tab): **Needs Review** (default-selected; selected = `--accent` fill, white text), **All**, **Sent**, then a divider and an "All categories" dropdown button. Selected non-primary chip fills with `--text` (near-black).

**Customer request row** (height ~71px; clickable; bottom border `--border-2`):
`[ 9px unread-dot slot ][ 40px avatar ][ 178px name+email ][ flex subject+snippet ][ 104px category tag ][ 118px status badge ][ 84px confidence ][ 62px time ]`
- Unread dot: 7px accent dot when `unread`.
- Avatar: 40px circle, initials 14px/600, tinted per the person (uses category-ish palettes).
- Name 14.5px (700 if unread) + email (mono 12px `--text-3`), both truncated.
- Subject (14px, 700 if unread) + **one-line snippet** (13px `--text-3`), both truncated with ellipsis.
- Category tag: fixed 104px, centered, 11px/600, pill, category bg/fg, nowrap.
- Status badge: pill, 11.5px/600, status bg/fg, nowrap; Drafting shows a pulsing dot.
- Confidence: 7px colored dot + label, in the confidence color (only when a draft exists).
- Time: 12px `--text-3`, right-aligned.

**Empty state (caught up):** shown when the Needs Review filter yields zero rows. Centered: 62px accent-soft circle with check icon, "You're all caught up" (18px/700), subtext "No threads need your review right now…".

**Loading / syncing state:** the header pill (above) + the top-bar Sync button spinner; both driven by a `syncing` flag (prototype auto-clears after ~1.7s).

**Filtered-out (noise) tab:** an explanatory line ("Automatically filtered by your sender rules… Manage rules") above a list of dimmed rows (opacity .78): 40px rounded-square monogram, name+email, subject, a neutral "rule matched" chip (e.g. "Domain: tiktokshop.com"), a "Not noise?" button, and time. Sample noise senders: TikTok Shop, Meta Business, Klaviyo, Stripe, Canva.

### 2. Thread / Draft Review  — **the heart of the app** (Layout A: "In-thread reply")
**Purpose:** read the customer's message, read the AI draft, verify against the order, decide to send.

**Layout:** column. `[ Review header 60px ][ Body flex:1 ]`. Body is a horizontal split:
`[ Left column flex:1.62 — conversation (scroll) + docked composer ][ Right context rail 392px, scroll, --surface-2 ]`.

- **Review header** (`--surface`, bottom border): back button (32px, chevron-left), category tag, subject (15px/600, truncated, max 520px), then right-aligned "Draft confidence" label + 3 confidence dots + level word.
- **Conversation (left, scroll, padding 24/30):** optional centered "Earlier in conversation · N messages" chip; then the latest message — 40px avatar, name (15px/600) + email (mono) + right-aligned timestamp, body paragraphs at 15.5px/1.68.
- **Composer (docked bottom of left column, `--surface-3`, top border):**
  - Header strip: 20px accent "✦" square, "AI draft", "· reply to {name} · generated as {Category}", right-aligned save state ("edited inline · autosaved").
  - **Editable draft box** (`contenteditable`): `--surface`, border, radius 10, padding 16/18, 14.5px/1.62, max-height 236px, scrolls. While regenerating, an overlay covers it with a spinner + "Regenerating draft…".
  - **Action bar:** **Approve & Send** (primary — accent fill, white text, send icon, radius 9, weight 600, with a mono "A" shortcut chip and inset highlight + soft green shadow); **Edit** (outline); **Regenerate** (outline, with circular-arrow icon); and a right-aligned, low-emphasis text button **"Dismiss · not a request"**.
- **Context rail (right):** eyebrow "CONTEXT", then:
  - **Shopify order card** (populated): header with green "S" tile + mono order number + order-status pill (Fulfilled = accent-soft, In transit = shipping-blue, etc.); line items (46px striped placeholder thumbnail + name + variant + mono price); footer rows: Ordered / Delivered (or Tracking) / Customer history (e.g. "3rd order · 1 prior exchange").
  - **Order empty state** (when no order matches the sender): dashed-border card, bag icon, "No matching order found", subtext.
  - **"Suggested action" callout** (only when the AI recommends a change it can't make): warm-amber card, flag icon + "SUGGESTED ACTION" label, body (e.g. "Refund $40 to order #MS-10456 — customer reports a damaged item…"), italic note with info icon: "Execute manually in Shopify — the console will not take this action." **This must read as a recommendation to the human, never an action the app takes.**
  - **"Draft based on"** sources: eyebrow + 1–3 cards, each a 26px rounded icon tile (book = KB entry, reply-arrow = past reply) + title + sub (e.g. "Knowledge base · 30-day window", "Past reply · #MS-9981").

### 3. Approvals queue
**Purpose:** focused, sequential review — "inbox zero, fast."

**Layout:** column on `--bg`. Header bar (`--surface`): H1 "Approvals" + "Focused review — one at a time", a centered progress block ("Reviewing X of N" + "N left to review" + accent progress bar), and a mono "J / K to move" hint chip.
- **Card** (centered, max-width 1080px, `--surface`, radius 16, shadow `0 4px 20px rgba(40,38,34,.06)`):
  - Header: 40px avatar, name + "· subject", mono email, category tag, confidence dot+label.
  - Two columns: left "CUSTOMER WROTE" (message paragraphs + a compact order chip if present); right "AI DRAFT REPLY" on `--surface-3` (accent ✦ tile in the eyebrow + draft paragraphs).
  - Footer action bar: **Approve & Send** (accent, "A" chip), **Edit** ("E" chip, opens full Review), **Dismiss** ("D" chip), right-aligned **Skip ›**.
- **Empty state (queue cleared):** centered accent-soft check circle, "Queue cleared", subtext.

### 4. Knowledge Base
**Purpose:** the canonical answers, policies, tone, and examples the AI draws from — all editable.

**Layout:** centered max-width 1000px; 2-col grid of cards.
- **Canonical answers** (full width): grid of answer cards, each with a category tag, mono usage count ("used 84×"), title, and a one-line body. Header has "+ Add answer".
- **Policies** (half): icon header + bullet list (accent dot + bold term + plain-language rule). Sample policies: Exchange window, Damaged items, Discounts, Refunds (note: "the console never issues refunds itself").
- **Tone profile** (half): a written voice description paragraph; a row of voice tags (Warm, Unhurried, First-person, Light contractions, "Warmly," sign-off); and a Do / Don't split.
- **Example library** (full width): "142 pairs"; list of Q→A rows, each with a category tag, the question, the answer (A: in accent), and an edit (pencil) button.

### 5. Insights
**Purpose:** trust instrumentation — "is the AI good enough to trust more?"

**Layout:** centered max-width 1080px.
- **Per-category cards** (5-col grid): category tag, big approval-rate metric (e.g. "94%") + "approved", "`vol` drafts · `edit%` edited", an accent mini progress bar at the approval %, and "avg confidence {level}" with a colored dot.
- **Per-category auto-send** card: titled with a "Coming soon" chip and copy stating this is a **future capability** the user will deliberately enable per category once earned. Rows per category are shown **dimmed (opacity .7) with the toggle OFF and disabled-feeling** (knob at rest, muted). Nothing here is interactive — it communicates trajectory without implying auto-send is active.
- **Audit log**: titled, with a search field; chronological rows of every sent email — accent-soft check badge, mono timestamp, summary (e.g. "Tracking details sent to James Park · #MS-10488"), category tag, "approved by Maya".

### 6. Settings
**Layout:** centered max-width 860px; stacked cards.
- **Connections**: Gmail (support@mollystitch.com) and Shopify (molly-stitch.myshopify.com) rows, each with an icon tile, name + status line, a green "Connected" pill, and a "Manage" button. (Design a disconnected variant by swapping the green pill for a muted/neutral "Disconnected" pill + a "Connect" primary action.)
- **Request categories**: editable list — color swatch + name + description + mono "~N/wk" volume + edit button; "+ Add category".
- **Sender rules** (the triage gate): two columns — **"Always a customer"** (green check header; allowlist: `*@gmail.com`, `*@outlook.com`, `*@icloud.com`, known-customer list) and **"Always filter out"** (red ✕ header; blocklist: `*@tiktokshop.com`, `*@klaviyo.com`, `*@facebookmail.com`, `receipts@stripe.com`). Each rule is a mono chip with a remove ✕.

---

## Interactions & Behavior

- **Navigation:** sidebar items switch the active screen. Clicking an Inbox row opens that thread in **Thread/Draft Review**; the back button (or `Esc`) returns to Inbox.
- **Inbox tabs/filters:** the Customer/Filtered-out segmented control swaps the list; status chips (Needs Review default / All / Sent) filter the customer list.
- **Sync:** clicking Sync sets a `syncing` flag → spinner in the top bar + a header pill (prototype clears after ~1.7s; real impl: clears when the fetch resolves).
- **Regenerate:** sets `regenerating` → overlay spinner on the draft for ~0.75s, then swaps to the next draft variant (prototype has 2 variants for some threads). Real impl: call the AI drafting endpoint.
- **Approve & Send (the sacred action):** never sends on the first click. It opens a **confirmation dialog** (`fadein` backdrop with blur + `popin` card): icon + "Send this reply?" + "This sends a real email — it can't be undone." + a preview block (To: mono email, category tag, truncated draft preview). Buttons: **Cancel** (esc) and **Send now** (accent, ↵). Confirming marks the thread **Sent**, closes the dialog, fires a success **toast** ("Reply sent to {name}", `toastin`, auto-dismiss ~2.6s), and — from Review — returns to Inbox; from Approvals — advances the queue. Keep it fast (done dozens of times a day) but deliberate.
- **Dismiss / Not a customer request:** marks the thread **Dismissed** and removes it from the review queue (toast confirms).
- **Keyboard shortcuts** (suppressed while focus is in an editable/input field, except Esc/Enter):
  - Review: `A` open send-confirm · `D` dismiss · `R` regenerate · `Esc` back.
  - Approvals: `A` send · `D` dismiss · `E` edit (open Review) · `J` next · `K` previous.
  - Confirm dialog open: `Enter` = send, `Esc` = cancel.
- **Hover/active/focus:** prototype keeps hovers subtle; in the real build give rows a `--hover` background on hover, buttons a slight darken (`--accent-press` for the primary), and visible focus rings for keyboard use (the contenteditable composer suppresses the default outline — replace with an accessible focus style).
- **Theme toggle:** flips `data-theme` between `light`/`dark` on the root; all colors are CSS variables, so the whole app retones. Persist the choice (prototype keeps it in component state).

## State Management
State variables in the prototype (map these to your store/router as appropriate):
- `screen`: `inbox | review | approvals | kb | insights | settings` (route).
- `theme`: `light | dark` (persist).
- `tab`: `customer | noise` (inbox segmented control).
- `statusFilter`: `needs | all | sent` (inbox chips).
- `selectedId`: id of the thread open in Review.
- `draftIndex`: which draft variant is shown; `regenerating`: bool (spinner).
- `apprIndex`: pointer into the Needs-Review queue for Approvals; queue is derived (`threads where status === 'Needs Review'`).
- `confirmOpen` + `sendCtx` (`review | approvals`): the send-confirm dialog and where it was triggered from.
- `syncing`: bool. `toast`: message string (auto-clears).
- `threads`: the data array. Each thread: `id, name, email, initials, avatar, subject, snippet, category, status, confidence (high|medium|low|null), time, unread, earlier (count), messages[{time, paras[]}], drafts[[paras]], order (or null), suggested (or null), basedOn[{icon,title,sub}]`.

Data fetching (real impl): list/sync threads from Gmail; classify + draft via the AI backend; fetch the matching Shopify order per thread; send via Gmail on approve; write to the audit log on every send.

## Assets
- **Fonts:** Source Sans 3 + IBM Plex Mono (Google Fonts). Use the codebase's font-loading approach.
- **Icons:** simple inline stroke SVGs (Feather-style: inbox, check-circle, book, bar-chart, gear/settings, chevrons, search, send/paper-plane, refresh, flag, reply-arrow, shopping-bag, info, sun/moon, mail, shield). Replace with the codebase's existing icon set.
- **Product imagery:** the order-card thumbnails are **striped placeholders** (diagonal `repeating-linear-gradient`). Swap in real Shopify product images.
- **Logos:** the "M" brand mark and the Gmail/Shopify connection icons are placeholders — use the real brand/integration logos in the target app.
- No raster image files are required by the prototype.

## Files
In this bundle:
- `Support Console.dc.html` — the full six-screen console (primary reference). Open in a browser to interact.
- `Review Layouts.dc.html` — the three explored Thread/Draft Review layouts (A/B/C). **Layout A was chosen** and is the one built into `Support Console.dc.html`; B and C are kept for context only.
- `support.js` — the prototype runtime the two HTML files load. **Reference only — do not port.**

To read the exact markup/values, open `Support Console.dc.html`: the `<x-dc>` template holds the layout and inline styles, the `:root` / `[data-theme="dark"]` blocks hold all tokens, and the `Component` class holds the seed data and interaction logic.
