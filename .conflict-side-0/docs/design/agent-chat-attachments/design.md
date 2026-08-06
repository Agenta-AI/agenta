# Agent chat: attachment panel

The composer's attachment surface — borders, guardrails, and the states it has to cover.
Branch: `fe-feat/agent-config-section-drawers`.

## Problem

The panel is the Ant Design X `Sender`'s `header` slot wrapping an `Attachments` component.
Two faults:

1. **Nested borders.** `Attachments` renders its own bordered placeholder card *inside* the
   `Sender`'s rounded border (plus a header `border-b`). The two rounded borders sit a few px
   apart → the doubled line you see when the panel opens empty.
2. **No guardrails.** `files.ts` reads any file, any size, any count into a base64 `data:` URL
   straight into the request body. No count cap, no size cap, no type filter, no feedback.

## Decision

Layout **B — seamless dropzone** (chosen over an inline chip tray and a source popover): keep an
explicit drop area but make it borderless so it shares the composer's single border; show file
cards when filled.

Guardrails (`assets/attachments.ts`, `DEFAULT_ATTACHMENT_LIMITS`):

- **Max 5 files** per message.
- **Max 5 MB per file** (base64 inflates ~33%, so ~6.6 MB on the wire).
- **Images and documents only** — `image/*`, `application/pdf`, `text/*`, `application/json`.
- Communicated: a `n / 5` counter, the limit in the placeholder, the paperclip disabled at the
  cap, and an inline red line per rejected file ("`report.pdf` is too large (8.2 MB) · max 5 MB
  per file") that never adds the bad file.

### Capability seam (not wired yet)

The limits are a single `AttachmentLimits` object, not scattered constants, and
`AgentChatPanel` reads one `limits` value (`const limits = DEFAULT_ATTACHMENT_LIMITS`). A later
change can compute limits from the selected model / harness capabilities (image-only model,
larger payloads, no attachments) and pass that object in its place — no call-site churn. Doing
that derivation is explicitly out of scope here.

## Implementation

We dropped Ant Design X `Attachments` and render the panel ourselves. The override route was a
dead end: `Attachments` fights us on every axis at once — its placeholder draws a nested
border + tinted box, its file cards are a fixed **268px** wide (the "huge thumbnails"), and
`Upload` defaults to single-file. A custom panel gives full control and matches the mockup.

- `assets/attachments.ts` — `AttachmentLimits`, `DEFAULT_ATTACHMENT_LIMITS`, `isAcceptedType`,
  `formatBytes`, `validateIncoming(incoming, currentCount, limits)` → `{accepted, rejections}`.
  Pure; the single enforcement point. Every entry path (picker, paste, drop) routes through it.
- `components/ComposerAttachments.tsx` — the panel UI. Empty: a borderless click-to-pick
  dropzone (no nested border by construction). Filled: a wrapped row of **48px** image
  thumbnails (object-URL previews, revoked on change) and slim file chips (icon + name + size +
  remove), an "add more" tile, and the `n / 5` counter. Owns a hidden
  `<input type="file" multiple accept=…>` — multi-select works.
- `AgentChatPanel.tsx`:
  - `addFiles` (picker / paste / drop) → `validateIncoming`; `removeFile` drops by uid.
  - Native whole-panel drag-and-drop: `onDragEnter/Over/Leave/Drop` on the outer wrapper with a
    depth counter (ignores child enter/leave flicker) and a "Drop files here" overlay. Multi-drop
    works (`Array.from(e.dataTransfer.files)`). Replaces antd's `getDropContainer`.
  - `accept={limits.acceptAttr}` hints the native picker; drop/paste validated by type anyway.

## States covered

Closed · open-empty (borderless dropzone + limit line) · drag-over (full-panel "Drop files
here" overlay) · filled (48px thumbnails + chips + `n / 5`) · at-limit (paperclip disabled,
no add tile) · rejected (inline red line, file not added).

## Open for live verify

- Border gone on the empty dropzone (should be, no antd placeholder now).
- Multi-select and multi-drop both attach all files.
- Thumbnail size feels right at 48px.
