/**
 * Visual-regression parity check — SELF-BASELINING.
 *
 * The comparison stories already render antd and agenta side by side, so antd IS the
 * baseline: for each story we screenshot the antd subject and the agenta subject and
 * pixel-diff them. No golden files to maintain, no per-component script tuning — any
 * visible difference (border, radius, shadow, colour, geometry, font) shows up as a diff
 * ratio + a written diff PNG. It is a DIAGNOSTIC: run it, look at the worst rows and their
 * diff images, fix what is real. Positioning/anti-alias noise stays well under 1%.
 *
 * It is generic over the two layout conventions used by every parity story:
 *   1. `.grid` rows  `[label | antd-cell | agenta-cell]`  → the control in each cell.
 *   2. `[data-open-compare]`                              → the antd overlay vs the agenta overlay.
 *
 * Usage (Storybook must be running on :6006):
 *   node parity/vrt.mjs                    # default story set, light + dark
 *   node parity/vrt.mjs <storyId> ...      # specific story ids
 *   STORYBOOK_URL=http://localhost:6006 node parity/vrt.mjs
 */
import {mkdirSync, rmSync, writeFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

import pixelmatch from "pixelmatch"
import {chromium} from "playwright"
import {PNG} from "pngjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
// VRT_OUT isolates the crop dir. `run()` starts with rmSync(OUT), so two concurrent runs
// would wipe each other's evidence — parallel agents MUST each set their own VRT_OUT.
const OUT = join(__dirname, process.env.VRT_OUT ?? "__vrt__")
const URL = process.env.STORYBOOK_URL ?? "http://localhost:6006"
const THEMES = ["light", "dark"]
// Rows above this fraction of differing pixels are flagged; below is sub-pixel/AA noise.
// 1% is the accepted ceiling. NOTE a ratio is only comparable within a fixed crop size —
// the same ~146 differing pixels reads 4.66% on a 3136px crop and 1.55% on a 9408px one.
// When comparing rows of different sizes, rank by absolute pixel count, not by this ratio.
const FLAG = 0.01
// Extra reloads allowed when the pseudo-states addon loses its race with antd's async
// cssinjs injection (see the detection in processOne). 3 gives ~1-in-a-thousand odds of a
// story slipping through if a single load misses ~1 time in 10.
const PSEUDO_RETRIES = 3

// Default set: every side-by-side story (closed controls, forced states, open panels).
const DEFAULT_STORIES = [
    // FULL INVENTORY GATE. Generated from every `export const X: Story` across stories/.
    // Excluded on purpose:
    //  - `<overlay>--antd-vs-agenta` for tooltip/dialog/alertdialog/sheet/dropdown: those cells
    //    are CLOSED triggers, so the pair is two buttons, not the overlay. `--open-state` gates them.
    //  - `*--playground`: interactive arg playgrounds, not antd|agenta pairs.
    //  - `run-name--*`: not an @agenta/ui component.
    // Rows that legitimately have no antd counterpart (`--agenta-only`) stay listed: the harness
    // reports 0 pairs for them, which is the honest signal (documented, not silently skipped).
    "agenta-ui-domain-cellrenderers--json",
    "agenta-ui-domain-cellrenderers--metric-bar",
    "agenta-ui-domain-cellrenderers--metrics",
    "agenta-ui-domain-cellrenderers--text",
    "agenta-ui-domain-chatmessage--assistant-message",
    "agenta-ui-domain-chatmessage--system-read-only",
    "agenta-ui-domain-chatmessage--tool-json",
    "agenta-ui-domain-chatmessage--user-message",
    "agenta-ui-domain-drillin--mocked-nested-data",
    "agenta-ui-domain-drillin--read-only",
    "agenta-ui-domain-editor--json-editable",
    "agenta-ui-domain-editor--json-read-only",
    "agenta-ui-domain-editor--rich-text-with-tokens",
    "agenta-ui-domain-editor--yaml-read-only",
    "agenta-ui-domain-llmicons--gallery",
    "agenta-ui-domain-llmicons--sizes",
    "agenta-ui-domain-richchatinput--comfortable",
    "agenta-ui-domain-richchatinput--default",
    "agenta-ui-domain-richchatinput--disabled",
    "agenta-ui-domain-richchatinput--streaming",
    "agenta-ui-domain-richchatinput--with-prefix",
    "agenta-ui-domain-selectllmprovider--flat",
    "agenta-ui-domain-selectllmprovider--grouped",
    "agenta-ui-domain-selectllmprovider--invalid",
    "agenta-ui-domain-sharededitor--code-json",
    "agenta-ui-domain-sharededitor--read-only",
    "agenta-ui-domain-sharededitor--rich-text",
    "agenta-ui-domain-sharededitor--with-header-footer",
    "agenta-ui-enhanced-button--antd-vs-agenta",
    "agenta-ui-enhanced-drawer--open-state",
    "agenta-ui-enhanced-modal--open-state",
    "agenta-ui-presentational-attachments-attachmentgrid--agenta-only",
    "agenta-ui-presentational-attachments-fileattachment--agenta-only",
    "agenta-ui-presentational-attachments-imageattachment--agenta-only",
    "agenta-ui-presentational-attachments-promptdocumentupload--antd-vs-agenta",
    "agenta-ui-presentational-attachments-promptimageupload--antd-vs-agenta",
    "agenta-ui-presentational-buttons-collapsetogglebutton--antd-vs-agenta",
    "agenta-ui-presentational-buttons-copybutton--antd-vs-agenta",
    "agenta-ui-presentational-buttons-dropdownbutton--antd-vs-agenta",
    "agenta-ui-presentational-buttons-runbutton--antd-vs-agenta",
    "agenta-ui-presentational-buttons-scrolltotopbutton--antd-vs-agenta",
    "agenta-ui-presentational-display-entitycard--agenta-only",
    "agenta-ui-presentational-display-entitytypeicon--agenta-only",
    "agenta-ui-presentational-display-executionmetricsdisplay--antd-vs-agenta",
    "agenta-ui-presentational-feedback-copytooltip--antd-vs-agenta",
    "agenta-ui-presentational-feedback-loadingskeleton--antd-vs-agenta",
    "agenta-ui-presentational-feedback-tableemptystate--antd-vs-agenta",
    "agenta-ui-presentational-forms-commitmessageinput--antd-vs-agenta",
    "agenta-ui-presentational-forms-editabletext--antd-vs-agenta",
    "agenta-ui-presentational-forms-fieldheader--agenta-only",
    "agenta-ui-presentational-forms-labelinput--agenta-only",
    "agenta-ui-presentational-forms-pathselectordropdown--antd-vs-agenta",
    "agenta-ui-presentational-forms-simpledropdownselect--antd-vs-agenta",
    "agenta-ui-presentational-forms-sliderinput--antd-vs-agenta",
    "agenta-ui-presentational-labels-authorlabel--agenta-only",
    "agenta-ui-presentational-labels-entityiconlabel--agenta-only",
    "agenta-ui-presentational-labels-entitylistitemlabel--agenta-only",
    "agenta-ui-presentational-labels-entitynamewithversion--agenta-only",
    "agenta-ui-presentational-labels-entitypathlabel--agenta-only",
    "agenta-ui-presentational-labels-formatteddate--antd-vs-agenta",
    "agenta-ui-presentational-labels-revisionlabel--agenta-only",
    "agenta-ui-presentational-layout-collapsiblegroupheader--agenta-only",
    "agenta-ui-presentational-layout-configaccordionsection--antd-vs-agenta",
    "agenta-ui-presentational-layout-heightcollapse--agenta-only",
    "agenta-ui-presentational-layout-metadataheader--antd-vs-agenta",
    "agenta-ui-presentational-layout-modalcontentlayout--antd-vs-agenta",
    "agenta-ui-presentational-layout-numberedstep--antd-vs-agenta",
    "agenta-ui-presentational-layout-pagelayout--antd-vs-agenta",
    "agenta-ui-presentational-layout-panelfooter--agenta-only",
    "agenta-ui-presentational-layout-panelheader--agenta-only",
    "agenta-ui-presentational-layout-scrollsentinel--agenta-only",
    "agenta-ui-presentational-layout-section--antd-vs-agenta",
    "agenta-ui-presentational-layout-splitpanellayout--antd-vs-agenta",
    "agenta-ui-presentational-media-imagepreview--antd-vs-agenta",
    "agenta-ui-presentational-media-imagewithfallback--antd-vs-agenta",
    "agenta-ui-presentational-media-initialsavatar--antd-vs-agenta",
    "agenta-ui-presentational-tags-sourceindicator--antd-vs-agenta",
    "agenta-ui-presentational-tags-tag--draft",
    "agenta-ui-presentational-tags-tag--environment",
    "agenta-ui-presentational-tags-tag--mapping",
    "agenta-ui-presentational-tags-tag--status",
    "agenta-ui-presentational-tags-tag--sync",
    "agenta-ui-presentational-tags-typechip--agenta-only",
    "agenta-ui-presentational-tags-versionbadge--agenta-only",
    "agenta-ui-primitives-display-alert--antd-vs-agenta",
    "agenta-ui-primitives-display-avatar--antd-vs-agenta",
    "agenta-ui-primitives-display-badge--antd-vs-agenta",
    "agenta-ui-primitives-display-badge--current-presets",
    "agenta-ui-primitives-display-badge--draft-collapse",
    "agenta-ui-primitives-display-badge--preset-colors",
    "agenta-ui-primitives-display-badge--semantic-variants",
    "agenta-ui-primitives-display-badge--status-collapse",
    "agenta-ui-primitives-display-badge--sync-collapse",
    "agenta-ui-primitives-display-breadcrumb--antd-vs-agenta",
    "agenta-ui-primitives-display-breadcrumb--interaction-states",
    "agenta-ui-primitives-display-collapse--antd-vs-agenta",
    "agenta-ui-primitives-display-collapse--interaction-states",
    "agenta-ui-primitives-display-divider--antd-vs-agenta",
    "agenta-ui-primitives-display-emptystate--antd-vs-agenta",
    "agenta-ui-primitives-display-tabs--antd-vs-agenta",
    "agenta-ui-primitives-display-tabs--interaction-states",
    "agenta-ui-primitives-feedback-progress--antd-vs-agenta",
    "agenta-ui-primitives-feedback-skeleton--antd-vs-agenta",
    "agenta-ui-primitives-feedback-spinner--antd-vs-agenta",
    "agenta-ui-primitives-feedback-spinner--sizes",
    "agenta-ui-primitives-feedback-spinner--with-tip",
    "agenta-ui-primitives-forms-button--absorbed-presets",
    "agenta-ui-primitives-forms-button--antd-vs-agenta",
    "agenta-ui-primitives-forms-button--danger",
    "agenta-ui-primitives-forms-button--icon-circle",
    "agenta-ui-primitives-forms-button--interaction-states",
    "agenta-ui-primitives-forms-button--primary",
    "agenta-ui-primitives-forms-button--small",
    "agenta-ui-primitives-forms-button--text",
    "agenta-ui-primitives-forms-button--used-in-app",
    "agenta-ui-primitives-forms-cascader--antd-vs-agenta",
    "agenta-ui-primitives-forms-checkbox--antd-vs-agenta",
    "agenta-ui-primitives-forms-checkbox--interaction-states",
    "agenta-ui-primitives-forms-combobox--antd-vs-agenta",
    "agenta-ui-primitives-forms-combobox--grouped",
    "agenta-ui-primitives-forms-combobox--interaction-states",
    "agenta-ui-primitives-forms-combobox--open-state",
    "agenta-ui-primitives-forms-field--antd-vs-agenta",
    "agenta-ui-primitives-forms-input--antd-vs-agenta",
    "agenta-ui-primitives-forms-input--interaction-states",
    "agenta-ui-primitives-forms-inputnumber--antd-vs-agenta",
    "agenta-ui-primitives-forms-radio--antd-vs-agenta",
    "agenta-ui-primitives-forms-radio--interaction-states",
    "agenta-ui-primitives-forms-segmented--antd-vs-agenta",
    "agenta-ui-primitives-forms-segmented--interaction-states",
    "agenta-ui-primitives-forms-select--antd-vs-agenta",
    "agenta-ui-primitives-forms-select--interaction-states",
    "agenta-ui-primitives-forms-select--open-state",
    "agenta-ui-primitives-forms-slider--antd-vs-agenta",
    "agenta-ui-primitives-forms-switch--antd-vs-agenta",
    "agenta-ui-primitives-forms-switch--interaction-states",
    "agenta-ui-primitives-overlays-alertdialog--open-state",
    "agenta-ui-primitives-overlays-dialog--open-state",
    "agenta-ui-primitives-overlays-dropdown--open-state",
    "agenta-ui-primitives-overlays-sheet--open-state",
    "agenta-ui-primitives-overlays-sheet--sides",
    "agenta-ui-primitives-overlays-tooltip--open-state",
]

/**
 * Stories that legitimately measure ZERO pairs, each with the reason. Everything NOT listed
 * here MUST measure at least one pair or the run fails — see the gate at the bottom.
 *
 * This list is the whole point: "0 pairs" used to be indistinguishable from "the dev server
 * was too slow to render the story", and the ambiguity resolved as a silent PASS. Adding an
 * entry is a claim you have to justify; leaving one out only ever costs you a failed run.
 *
 * Every entry below was verified by reading the story file: zero `from "antd"` imports AND
 * zero `>antd<` captions, i.e. there is no antd half to compare against.
 */
const NO_PAIR_EXPECTED = new Map([
    // Domain stories: single-render showcases of components that were never antd.
    ...[
        "agenta-ui-domain-cellrenderers--text",
        "agenta-ui-domain-cellrenderers--json",
        "agenta-ui-domain-cellrenderers--metrics",
        "agenta-ui-domain-cellrenderers--metric-bar",
        "agenta-ui-domain-chatmessage--user-message",
        "agenta-ui-domain-chatmessage--assistant-message",
        "agenta-ui-domain-chatmessage--system-read-only",
        "agenta-ui-domain-chatmessage--tool-json",
        "agenta-ui-domain-drillin--mocked-nested-data",
        "agenta-ui-domain-drillin--read-only",
        "agenta-ui-domain-editor--json-read-only",
        "agenta-ui-domain-editor--json-editable",
        "agenta-ui-domain-editor--yaml-read-only",
        "agenta-ui-domain-editor--rich-text-with-tokens",
        "agenta-ui-domain-llmicons--gallery",
        "agenta-ui-domain-llmicons--sizes",
        "agenta-ui-domain-richchatinput--default",
        "agenta-ui-domain-richchatinput--with-prefix",
        "agenta-ui-domain-richchatinput--streaming",
        "agenta-ui-domain-richchatinput--comfortable",
        "agenta-ui-domain-richchatinput--disabled",
        "agenta-ui-domain-selectllmprovider--flat",
        "agenta-ui-domain-selectllmprovider--grouped",
        "agenta-ui-domain-selectllmprovider--invalid",
        "agenta-ui-domain-sharededitor--rich-text",
        "agenta-ui-domain-sharededitor--code-json",
        "agenta-ui-domain-sharededitor--read-only",
        "agenta-ui-domain-sharededitor--with-header-footer",
    ].map((id) => [id, "domain story — no antd import, no antd caption, single-render"]),
    // `--agenta-only` by name: the component has no antd ancestor at all.
    ...[
        "agenta-ui-presentational-attachments-attachmentgrid--agenta-only",
        "agenta-ui-presentational-attachments-fileattachment--agenta-only",
        "agenta-ui-presentational-attachments-imageattachment--agenta-only",
        "agenta-ui-presentational-display-entitytypeicon--agenta-only",
        "agenta-ui-presentational-forms-fieldheader--agenta-only",
        "agenta-ui-presentational-forms-labelinput--agenta-only",
        "agenta-ui-presentational-labels-entityiconlabel--agenta-only",
        "agenta-ui-presentational-labels-entitylistitemlabel--agenta-only",
        "agenta-ui-presentational-labels-entitynamewithversion--agenta-only",
        "agenta-ui-presentational-labels-entitypathlabel--agenta-only",
        "agenta-ui-presentational-layout-panelheader--agenta-only",
    ].map((id) => [id, "--agenta-only — no antd counterpart"]),
    // Renamed from `--antd-vs-agenta`: the old name was a lie (0 antd imports in the story).
    ...[
        "agenta-ui-presentational-display-entitycard--agenta-only",
        "agenta-ui-presentational-labels-authorlabel--agenta-only",
        "agenta-ui-presentational-labels-revisionlabel--agenta-only",
        "agenta-ui-presentational-tags-typechip--agenta-only",
        "agenta-ui-presentational-tags-versionbadge--agenta-only",
        "agenta-ui-presentational-layout-collapsiblegroupheader--agenta-only",
        "agenta-ui-presentational-layout-heightcollapse--agenta-only",
        "agenta-ui-presentational-layout-panelfooter--agenta-only",
        "agenta-ui-presentational-layout-scrollsentinel--agenta-only",
    ].map((id) => [id, "renamed from --antd-vs-agenta: never had an antd half"]),
    // Single-variant showcases: their file's antd captions belong to its OTHER exports
    // (`--antd-vs-agenta` / `--interaction-states` / `--open-state`), which do gate.
    ...[
        "agenta-ui-primitives-display-badge--current-presets",
        "agenta-ui-primitives-display-badge--semantic-variants",
        "agenta-ui-primitives-feedback-spinner--sizes",
        "agenta-ui-primitives-feedback-spinner--with-tip",
        "agenta-ui-primitives-forms-button--absorbed-presets",
        "agenta-ui-primitives-forms-button--danger",
        "agenta-ui-primitives-forms-button--icon-circle",
        "agenta-ui-primitives-forms-button--primary",
        "agenta-ui-primitives-forms-button--small",
        "agenta-ui-primitives-forms-button--text",
        "agenta-ui-primitives-forms-button--used-in-app",
        "agenta-ui-primitives-forms-combobox--grouped",
        "agenta-ui-primitives-overlays-sheet--sides",
    ].map((id) => [id, "single-variant showcase — no antd half in this export"]),
])

const stories = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_STORIES

/** In-page: return [{label, antd:{x,y,w,h}, agenta:{x,y,w,h}}] for the story's subjects. */
function collectPairs() {
    // Order-independent: querySelector returns the DOM-first match, so composed wrappers
    // (which contain the inner input) must be listed or the bare <input> gets picked and
    // compared against antd's full affix wrapper — a false positive.
    // `[data-vrt-subject]` is the explicit opt-in hook: put it on an antd element this list does
    // not name (e.g. `.ant-typography`) so the cell has a real subject instead of falling back to
    // `firstElementChild` — which in the `[caption, control]` cell layout is the "antd"/"agenta"
    // caption, i.e. a silently meaningless pair.
    const SUBJECT =
        "[data-vrt-subject], .ant-input-affix-wrapper, [data-slot=input-affix], [data-slot=search-input], [data-slot=password-input], .ant-select, .ant-collapse, [data-slot=accordion], .ant-skeleton, [data-slot^=skeleton], .ant-spin, [data-slot=spinner], .ant-progress, [data-slot=progress], .ant-segmented, [data-slot=segmented], .ant-avatar, [data-slot=avatar], .ant-breadcrumb, [data-slot=breadcrumb], [data-slot=field-header], .ant-empty, [data-slot=empty-state], [data-slot$=trigger], .ant-radio, [data-slot=radio-group-item], .ant-checkbox, [data-slot=checkbox], .ant-alert, [data-slot=alert], .ant-divider, [data-slot=divider], .ant-tabs-nav, [data-slot=tabs-list], .ant-input-number, [data-slot=input-number], .ant-slider, [data-slot=slider], .ant-cascader, [data-slot=cascader-trigger], .ant-message-notice, [data-slot=toast-wrapper], .ant-notification-notice, [data-slot=notification], button, [data-slot=badge], .ant-tag, input, textarea"
    // Nullish-safe: a `.grid` row that is NOT a [label|antd|agenta] triple (showcase grids,
    // `--agenta-only` stories with no antd half) has no children[2]. Returning null lets the
    // filter below drop the row instead of throwing and killing the whole story's run.
    const subjectIn = (cell) => cell?.querySelector(SUBJECT) ?? cell?.firstElementChild ?? null

    // A cell is `<div><span class="text-[10px]">antd</span><control/></div>`. When SUBJECT
    // matches nothing, `firstElementChild` returns that CAPTION span — so the row silently
    // compares a caption against a real control and reports a meaningless (often passing)
    // ratio. Detect it and surface the row as BROKEN instead of a number. Fix by adding
    // `data-vrt-subject` to the real element in the story (already in SUBJECT).
    const isCaptionEl = (el) => /^(antd|agenta)$/i.test((el?.textContent || "").trim())
    const r = (el) => {
        if (!el) return null
        const {x, y, width, height} = el.getBoundingClientRect()
        return {x, y, w: width, h: height}
    }

    // Layout 2: forced-open overlays — antd dropdown vs agenta popover/select content.
    // `data-vrt-expected="reason"` declares a KNOWN deliberate diff (e.g. the Select selected-
    // check antd v6 lacks): still measured, but reported as expected (ungated), not a failure.
    const openCompare = document.querySelector("[data-open-compare]")
    if (openCompare) {
        const antd = openCompare.querySelector(
            ".ant-select-dropdown, .ant-tooltip, .ant-popover, .ant-dropdown, .ant-modal-container, .ant-drawer-content-wrapper",
        )
        const agenta = openCompare.querySelector(
            "[data-slot=popover-content], [data-slot=select-content], [data-slot=tooltip-content], [data-slot=dropdown-menu-content], [data-slot=dialog-content], [data-slot=sheet-content], [data-slot=alert-dialog-content]",
        )
        return [
            {
                label: "open-panel",
                antd: r(antd),
                agenta: r(agenta),
                expected: openCompare.getAttribute("data-vrt-expected") || null,
            },
        ]
    }

    // Layout 1: `.grid` rows `[label | antd-cell | agenta-cell]`. A row whose label says
    // "not reproduced" is an intentional structural difference (opted out of the pixel gate).
    // A composite with no antd equivalent puts an italic CAPTION in the antd cell
    // ("no single antd counterpart …" / "agenta only, no antd counterpart"). Diffing that
    // caption against a real component yields a meaningless ~95% — detect and drop those rows.
    const isCaptionOnly = (cell) =>
        /no (single )?antd counterpart|agenta only/i.test(cell?.textContent || "")

    // A PARITY row is identified by its captions: cell 1 contains "antd", cell 2 "agenta".
    // Any other `.grid` (icon galleries, showcase grids, arbitrary layout) is NOT a comparison
    // — pairing its columns produces a real-looking ratio for two unrelated elements.
    const hasCaption = (cell, word) =>
        !!cell &&
        [...cell.children].some((el) => (el.textContent || "").trim().toLowerCase() === word)
    const isParityRow = (row) =>
        hasCaption(row.children[1], "antd") && hasCaption(row.children[2], "agenta")

    return [...document.querySelectorAll(".grid")]
        .filter(isParityRow)
        .map((row) => {
            const label = row.children[0]?.textContent?.trim() || "row"
            if (isCaptionOnly(row.children[1])) return {label, antd: null, agenta: null}
            const antdEl = subjectIn(row.children[1])
            const agentaEl = subjectIn(row.children[2])
            // Picked the caption instead of the control → the ratio would be meaningless.
            const brokenSide = isCaptionEl(antdEl)
                ? "antd"
                : isCaptionEl(agentaEl)
                  ? "agenta"
                  : null
            if (brokenSide) return {label, antd: null, agenta: null, broken: brokenSide}
            // AMBIGUOUS SUBJECT: >1 candidate in a cell and no data-vrt-subject means
            // querySelector silently crops the FIRST one (how DropdownButton read 0.00%
            // while its chevrons differed). Refuse to guess.
            const ambig = (cell) =>
                cell.querySelectorAll(SUBJECT).length > 1 &&
                !cell.querySelector("[data-vrt-subject]")
            const ambigSide = ambig(row.children[1])
                ? "antd"
                : ambig(row.children[2])
                  ? "agenta"
                  : null
            if (ambigSide)
                return {label, antd: null, agenta: null, broken: ambigSide, ambiguous: true}
            // `data-vrt-expected` on the row (or any ancestor) declares a KNOWN deliberate
            // divergence — still measured and reported, just not a failure. Grid rows used to
            // have no such escape hatch: the only option was a `not reproduced` label, which
            // DROPS the row and takes its geometry coverage with it. That is too blunt for a
            // deliberate colour change, where everything except the colour should stay gated.
            const expected = row.closest("[data-vrt-expected]")?.dataset.vrtExpected || null
            return {label, antd: r(antdEl), agenta: r(agentaEl), expected}
        })
        .filter((p) => (p.broken || (p.antd && p.agenta)) && !/not reproduced/i.test(p.label))
}

/** Crop a device-pixel sub-rect out of a full-page PNG. */
function crop(png, rect, dpr) {
    const x = Math.round(rect.x * dpr)
    const y = Math.round(rect.y * dpr)
    const w = Math.max(1, Math.round(rect.w * dpr))
    const h = Math.max(1, Math.round(rect.h * dpr))
    const out = new PNG({width: w, height: h})
    PNG.bitblt(
        png,
        out,
        Math.min(x, png.width - 1),
        Math.min(y, png.height - 1),
        Math.min(w, png.width - x),
        Math.min(h, png.height - y),
        0,
        0,
    )
    return out
}

/** Pad a PNG onto a w×h canvas (top-left aligned). The gap is filled OPAQUE mid-gray, not
 * transparent: pixelmatch blends transparent toward white, which would make a size-mismatch
 * falsely MATCH a light page and falsely DIFFER from a dark page (theme-asymmetric false
 * positives). Opaque gray makes a genuine size difference read the same in both themes. */
function pad(png, w, h) {
    if (png.width === w && png.height === h) return png
    const out = new PNG({width: w, height: h})
    for (let i = 0; i < out.data.length; i += 4) {
        out.data[i] = out.data[i + 1] = out.data[i + 2] = 128
        out.data[i + 3] = 255
    }
    PNG.bitblt(png, out, 0, 0, Math.min(png.width, w), Math.min(png.height, h), 0, 0)
    return out
}

/**
 * PREFLIGHT. A non-compiling Storybook renders an error overlay (or nothing), which yields
 * 0 pairs — and "0 pairs" used to read as "all within threshold", i.e. a total false pass.
 * Refuse to run at all unless the server is up AND a story bundle actually compiles.
 */
async function preflight(browser, dpr) {
    let res
    try {
        res = await fetch(`${URL}/index.json`)
    } catch {
        throw new Error(`Storybook is not reachable at ${URL} — start it before running the VRT.`)
    }
    if (!res.ok) throw new Error(`Storybook index.json returned ${res.status} at ${URL}.`)
    const index = await res.json()
    // Probe up to 3 stories, not just the first. `stories[0]` is whatever happens to sort
    // first in DEFAULT_STORIES — currently `cellrenderers--json`, which pulls a huge dep graph
    // and does not reach domcontentloaded within 120s on a loaded machine, while a light story
    // loads in ~1.5s. A slow FIRST story was aborting the entire suite before it measured
    // anything. Preflight only needs SOME story to prove Storybook compiles.
    const probes = stories.filter((id) => index.entries?.[id]).slice(0, 3)
    if (!probes.length) probes.push(stories[0])

    const page = await browser.newPage({deviceScaleFactor: dpr})
    try {
        // The FIRST story load pays a cold Vite/webpack compile for the whole story graph and
        // routinely blows past 30s — that killed the preflight outright (and was the source of
        // the run's "page.goto Timeout 30000ms" errors). Long timeout plus one retry, so a
        // cold dev server costs a slow start instead of a dead run.
        let probe = null
        for (const candidate of probes) {
            try {
                await page.goto(`${URL}/iframe.html?id=${candidate}&viewMode=story`, {
                    waitUntil: "domcontentloaded",
                    timeout: 120_000,
                })
                probe = candidate
                break
            } catch {
                console.log(`   (preflight: ${candidate} did not load in 120s, trying next)`)
            }
        }
        if (!probe)
            throw new Error(
                `Storybook at ${URL} served none of ${probes.length} probe stories within 120s ` +
                    `each (${probes.join(", ")}). It is running but too slow or wedged — restart it,\n` +
                    `   and check host load: a saturated machine looks exactly like a wedged server.`,
            )
        await page.waitForTimeout(1500)
        // Webpack/Vite inject a VISIBLE overlay on a compile error; Storybook also ships a
        // permanently-hidden #error-message placeholder, so check visibility, not presence.
        const broken = await page.evaluate(() => {
            const visible = (el) => el && el.offsetParent !== null && el.textContent?.trim()
            const overlay = [
                ...document.querySelectorAll(
                    "#error-message, .sb-errordisplay, #webpack-dev-server-client-overlay",
                ),
            ].find(visible)
            return overlay ? (overlay.textContent || "").slice(0, 400) : null
        })
        if (broken) {
            throw new Error(
                `Storybook is NOT COMPILING — every VRT result would be meaningless.\n` +
                    `   Probe story: ${probe}\n   Overlay says: ${broken}`,
            )
        }
    } finally {
        await page.close()
    }
}

/**
 * One (story, theme) unit. `ctx` owns the page so a crash-replacement propagates back
 * to the worker. Returns the number of pairs measured (0 = not a parity layout).
 */
async function processOne(ctx, id, theme, results) {
    const {browser, dpr} = ctx
    const before = results.length
    let measured = 0
    const url = `${URL}/iframe.html?id=${id}&globals=theme:${theme}&viewMode=story`
    try {
        // NOT networkidle — Storybook keeps a channel open, so it never fires. Wait for
        // the story root + a known layout marker instead.
        //
        // Nav + layout detection RETRIES once. "No layout" is indistinguishable from
        // "dev server too slow to serve this story", and the slow case is not
        // hypothetical: one run reported "not a parity layout" for 56 stories —
        // checkbox/radio/splitpanellayout among them — that demonstrably DO have grids.
        // A retry turns that starvation artifact back into a real measurement.
        let hasLayout = false
        let navError = null
        for (let attempt = 0; attempt <= PSEUDO_RETRIES && !hasLayout; attempt++) {
            try {
                // Recover from a dead page (Chromium can die mid-suite on long runs).
                if (ctx.page.isClosed()) ctx.page = await browser.newPage({deviceScaleFactor: dpr})
                await ctx.page.goto(url, {waitUntil: "domcontentloaded", timeout: 60_000})
                navError = null
            } catch (e) {
                navError = e
                continue
            }
            hasLayout = await ctx.page
                .waitForSelector(".grid, [data-open-compare]", {timeout: 15_000})
                .then(() => true)
                .catch(() => false)
            // storybook-addon-pseudo-states rewrites `:hover`/`:focus-visible` rules into
            // `.pseudo-*` classes ONCE per load, walking document.styleSheets. antd styles via
            // cssinjs and injects asynchronously, so the walk intermittently runs before antd's
            // sheet exists — the antd half then renders its RESTING state and the row reports a
            // large, entirely bogus diff. It MOVES between components run to run (radio in one
            // pass, checkbox the next), which is what proves it is a race and not a bug.
            // Detect it directly: forced-state DOM present but no rewritten antd rule => retry.
            if (hasLayout && attempt < PSEUDO_RETRIES) {
                const missed = await ctx.page
                    .evaluate(() => {
                        const forced = document.querySelector('[class*="pseudo-"]')
                        if (!forced) return false
                        // Scope to the antd COMPONENT this story renders. antd emits one cssinjs
                        // style tag per component, so a global ".ant- was rewritten" check passes
                        // as soon as any unrelated component's sheet lands — which is exactly why
                        // a coarser version of this check never fired.
                        const bases = new Set()
                        for (const wrap of document.querySelectorAll('[class*="pseudo-"]'))
                            for (const el of wrap.querySelectorAll('[class*="ant-"]'))
                                for (const c of el.classList) {
                                    const m = /^ant-([a-z]+)/.exec(c)
                                    if (m) bases.add(`.ant-${m[1]}`)
                                }
                        if (!bases.size) return false
                        // ORDER-AWARE: antd's cssinjs RE-INJECTS after the addon's one-shot
                        // rewrite (dark especially), and the newer un-rewritten sheet wins the
                        // cascade — so "a rewritten rule exists somewhere" is not enough. The
                        // pseudo rule must be at/after the LAST sheet styling that base, else the
                        // rewrite is stale and the screenshot shows the RESTING state. And EVERY
                        // forced base must be covered — `.ant-btn` cannot cover for `.ant-checkbox`.
                        const lastBase = new Map()
                        const lastPseudo = new Map()
                        const sheets = [...document.styleSheets]
                        for (let i = 0; i < sheets.length; i++) {
                            let rules
                            try {
                                rules = sheets[i].cssRules
                            } catch {
                                continue
                            }
                            for (const rule of rules) {
                                const sel = rule.selectorText
                                if (!sel) continue
                                for (const b of bases) {
                                    if (!sel.includes(b)) continue
                                    lastBase.set(b, i)
                                    if (sel.includes("pseudo-")) lastPseudo.set(b, i)
                                }
                            }
                        }
                        for (const b of bases) {
                            if (!lastBase.has(b)) continue
                            if (!lastPseudo.has(b) || lastPseudo.get(b) < lastBase.get(b))
                                return true
                        }
                        return false
                    })
                    .catch(() => false)
                if (missed) hasLayout = false // fall through to the retry below
            }
        }
        if (navError) throw navError
        // A story with NO [label|antd|agenta] grid (single-column showcases, arg-only
        // stories) is not a parity story — that is "0 pairs", NOT an error. Whether that
        // is legitimate is decided by NO_PAIR_EXPECTED at gate time, not here.
        if (!hasLayout) {
            results.push({
                id,
                theme,
                label: "(no pairs — not a parity layout)",
                ratio: null,
            })
            return
        }
        // Open-compare panels portal in AFTER the wrapper mounts (the container ref needs
        // a render tick), so `[data-open-compare]` existing ≠ the overlays are present.
        // Wait for BOTH halves to actually land in the box or the crop reads a null rect.
        if (await ctx.page.$("[data-open-compare]")) {
            await ctx.page
                .waitForFunction(
                    () => {
                        const oc = document.querySelector("[data-open-compare]")
                        if (!oc) return false
                        const antd = oc.querySelector(
                            ".ant-select-dropdown, .ant-tooltip, .ant-popover, .ant-dropdown, .ant-modal-container, .ant-drawer-content-wrapper",
                        )
                        const agenta = oc.querySelector(
                            "[data-slot=popover-content], [data-slot=select-content], [data-slot=tooltip-content], [data-slot=dropdown-menu-content], [data-slot=dialog-content], [data-slot=sheet-content], [data-slot=alert-dialog-content]",
                        )
                        return !!antd && !!agenta
                    },
                    {timeout: 10_000},
                )
                .catch(() => {})
        }
        // `document.fonts.ready` has NO timeout of its own — if it never settles, node
        // hangs forever with no output. Race it against a deadline.
        await Promise.race([
            ctx.page.evaluate(() => document.fonts?.ready).catch(() => {}),
            new Promise((r) => setTimeout(r, 3_000)),
        ])
        // Kill transitions/animations DECLARATIVELY, before the imperative freeze below.
        //
        // The freeze alone was not enough and produced a whole class of phantom diffs.
        // antd styles via cssinjs, which injects the forced `.pseudo-*` rules only after
        // this point — so on `--interaction-states` stories the antd half was screenshotted
        // partway through its 0.2s `motionDurationMid` transition while our static Tailwind
        // half already showed 100%. The measured "diffs" were exact linear interpolations
        // between two real antd tokens (e.g. 71% of colorPrimary→colorPrimaryHover): a
        // stopwatch reading, not a colour bug. CSS is declarative and applies to rules
        // injected later, so this snaps any such transition straight to its end state.
        await ctx.page.addStyleTag({
            content: `*,*::before,*::after{transition-duration:0s !important;transition-delay:0s !important;animation-duration:0s !important;animation-delay:0s !important;animation-iteration-count:1 !important}`,
        })
        // FORCED-STATE RE-INJECTION. The pseudo-states addon rewrites :hover/:focus rules
        // ONCE per load; antd's cssinjs re-injects later (dark especially) and the newer
        // un-rewritten sheet wins the cascade, so the antd half screenshots at its RESTING
        // state. Four detection heuristics failed to close this race. Instead, make it
        // impossible: copy every pseudo-class rule into its `.pseudo-<state>-all` form in a
        // style tag appended LAST — last-in-order wins ties regardless of injection timing.
        await ctx.page.evaluate(() => {
            document.querySelector("[data-vrt-pseudo-force]")?.remove()
            const STATES = ["hover", "focus-visible", "focus-within", "active"]
            let css = ""
            for (const sheet of document.styleSheets) {
                let rules
                try {
                    rules = sheet.cssRules
                } catch {
                    continue
                }
                for (const rule of rules) {
                    const sel = rule.selectorText
                    if (!sel) continue
                    for (const st of STATES) {
                        const re = new RegExp(":" + st + "(?![\\w-])", "g")
                        if (!re.test(sel)) continue
                        const parts = sel
                            .split(",")
                            .map((x) => x.trim())
                            .filter((x) => new RegExp(":" + st + "(?![\\w-])").test(x))
                            .map((x) => `.pseudo-${st}-all ` + x.replace(re, ""))
                        if (parts.length) css += rule.cssText.replace(sel, parts.join(", ")) + "\n"
                    }
                }
            }
            const tag = document.createElement("style")
            tag.setAttribute("data-vrt-pseudo-force", "")
            tag.textContent = css
            document.head.appendChild(tag)
        })
        // Still needed for animations already in flight (JS/WAAPI, not CSS).
        await ctx.page.evaluate(() =>
            document.querySelectorAll("*").forEach((el) =>
                el.getAnimations?.().forEach((a) => {
                    // .finish() throws on infinite animations (e.g. loading spinners).
                    try {
                        a.finish()
                    } catch {
                        a.pause()
                    }
                }),
            ),
        )
        await ctx.page.waitForTimeout(200)
        const pairs = await ctx.page.evaluate(collectPairs)
        if (!pairs.length) {
            results.push({id, theme, label: "(no pairs)", ratio: null})
            return
        }
        const shot = PNG.sync.read(await ctx.page.screenshot({fullPage: true}))
        pairs.forEach((p, i) => {
            if (p.broken) {
                results.push({
                    id,
                    theme,
                    label: p.label,
                    ratio: null,
                    broken: p.broken,
                    ambiguous: p.ambiguous,
                })
                return
            }
            const a = crop(shot, p.antd, dpr)
            const s = crop(shot, p.agenta, dpr)
            const w = Math.max(a.width, s.width)
            const h = Math.max(a.height, s.height)
            const A = pad(a, w, h)
            const S = pad(s, w, h)
            const diff = new PNG({width: w, height: h})
            const bad = pixelmatch(A.data, S.data, diff.data, w, h, {
                threshold: 0.1,
                includeAA: false,
            })
            const ratio = bad / (w * h)
            const dir = join(OUT, id)
            mkdirSync(dir, {recursive: true})
            const base = `${theme}-${i}-${p.label.replace(/[^a-z0-9]+/gi, "_").slice(0, 24)}`
            if (ratio > FLAG) {
                writeFileSync(join(dir, `${base}.antd.png`), PNG.sync.write(A))
                writeFileSync(join(dir, `${base}.agenta.png`), PNG.sync.write(S))
                writeFileSync(join(dir, `${base}.diff.png`), PNG.sync.write(diff))
            }
            results.push({
                id,
                theme,
                label: p.label,
                ratio,
                w,
                h,
                bad,
                expected: p.expected,
            })
        })
    } catch (err) {
        results.push({id, theme, label: `ERROR: ${err.message}`, ratio: null})
        // A crashed page/context poisons every later story — replace it so one bad
        // story can't cascade into a whole-suite failure.
        if (/closed|crash|Target|detached/i.test(err.message)) {
            try {
                if (!ctx.page.isClosed()) await ctx.page.close()
            } catch {}
            ctx.page = await browser.newPage({deviceScaleFactor: dpr})
        }
    }
    measured = results.filter((r, n) => n >= before && r.ratio != null).length
    return measured
}

async function run() {
    rmSync(OUT, {recursive: true, force: true})
    mkdirSync(OUT, {recursive: true})
    const browser = await chromium.launch()
    const dpr = 2
    await preflight(browser, dpr)
    const results = []

    // Stories run CONCURRENTLY (one page each); themes stay sequential inside a story so a
    // story with no parity rows can skip its dark pass. 284 sequential page loads was ~34min.
    const CONCURRENCY = Math.max(1, Number(process.env.VRT_CONCURRENCY ?? 3))
    const queue = [...stories]
    const workers = await Promise.all(
        Array.from({length: Math.min(CONCURRENCY, queue.length)}, async () => ({
            browser,
            dpr,
            page: await browser.newPage({deviceScaleFactor: dpr}),
        })),
    )
    await Promise.all(
        workers.map(async (ctx) => {
            while (queue.length) {
                const id = queue.shift()
                if (!id) break
                const n = await processOne(ctx, id, THEMES[0], results)
                // No parity rows in light => none in dark either; skip the second load.
                if (n > 0) await processOne(ctx, id, THEMES[1], results)
            }
            if (!ctx.page.isClosed()) await ctx.page.close()
        }),
    )

    await browser.close()

    const over = results.filter((r) => r.ratio != null && r.ratio > FLAG)
    const flagged = over.filter((r) => !r.expected).sort((a, b) => b.ratio - a.ratio)
    const expected = over.filter((r) => r.expected).sort((a, b) => b.ratio - a.ratio)
    writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2))

    console.log(
        `\nVRT — ${results.length} comparisons across ${stories.length} stories (light+dark)`,
    )
    console.log(`baseline = antd half of each story · diffs written to parity/__vrt__/<story>/\n`)

    // Broken subject picking = a silently meaningless pair (often a false PASS). Report these
    // LOUDLY and separately from ratios: the row measured a caption, not the control.
    const broken = results.filter((r) => r.broken)
    if (broken.length) {
        console.log(
            `\n🚨 ${broken.length} BROKEN pair(s) — subject resolved to the "antd"/"agenta" CAPTION,`,
        )
        console.log(
            `   so no real comparison happened. Add \`data-vrt-subject\` to the real element:\n`,
        )
        for (const r of broken) {
            const why = r.ambiguous ? "AMBIGUOUS (>1 candidate)" : "caption-as-subject"
            console.log(
                `   [${r.broken} side] ${r.theme.padEnd(5)} ${r.id}  →  ${r.label}  (${why})`,
            )
        }
        console.log("")
    }

    if (!flagged.length) {
        console.log(`✓ all pairs within ${(FLAG * 100).toFixed(1)}% — no visible mismatch`)
    } else {
        console.log(`⚠ ${flagged.length} pair(s) over ${(FLAG * 100).toFixed(1)}%:\n`)
        for (const r of flagged) {
            console.log(
                `  ${(r.ratio * 100).toFixed(2).padStart(6)}%  ${r.theme.padEnd(5)} ${r.id}  →  ${r.label}`,
            )
        }
    }
    if (expected.length) {
        console.log(
            `\nℹ ${expected.length} expected/ungated diff(s) (declared via data-vrt-expected):`,
        )
        for (const r of expected) {
            console.log(
                `  ${(r.ratio * 100).toFixed(2).padStart(6)}%  ${r.theme.padEnd(5)} ${r.id}  →  ${r.label} — ${r.expected}`,
            )
        }
    }
    const errors = results.filter((r) => String(r.label).startsWith("ERROR"))
    if (errors.length) {
        console.log(`\n✗ ${errors.length} story error(s):`)
        for (const e of errors) console.log(`  ${e.id} [${e.theme}]: ${e.label}`)
    }

    // A story that measured ZERO pairs did not pass — it failed to render, or its
    // captions/subjects stopped matching. Silent 0-pairs was the last false-PASS path (it hid
    // a real ~22% Tag diff, and it hid 133 unmeasured stories when concurrency was raised too
    // high).
    //
    // The gate DEFAULTS TO FAILING. It used to fail only on `--antd-vs-agenta`/`--open-state`
    // suffixes, which let every `--interaction-states` story measure nothing and still pass —
    // and those suffixes cannot classify the parity stories with arbitrary names
    // (`tag--status`, `badge--status-collapse`). So: any story that measures nothing is a
    // failure unless it is listed in NO_PAIR_EXPECTED with a reason.
    const measuredIds = new Set(results.filter((r) => r.ratio != null).map((r) => r.id))
    const unmeasured = [...new Set(results.map((r) => r.id))]
        .filter((id) => !measuredIds.has(id))
        .filter((id) => !NO_PAIR_EXPECTED.has(id))
        .sort()
    const skipped = [...new Set(results.map((r) => r.id))]
        .filter((id) => !measuredIds.has(id) && NO_PAIR_EXPECTED.has(id))
        .sort()
    if (skipped.length) {
        console.log(`\nℹ ${skipped.length} story(ies) with no antd pair by design (not gated):`)
        for (const id of skipped) console.log(`   ${id}  — ${NO_PAIR_EXPECTED.get(id)}`)
    }
    if (unmeasured.length) {
        console.log(
            `\n🚨 ${unmeasured.length} comparison story(ies) measured ZERO pairs — not a pass:\n`,
        )
        for (const id of unmeasured) console.log(`   ${id}`)
        console.log(
            `\n   Causes: story failed to render (check Storybook), the [label|antd|agenta]\n` +
                `   captions are missing, or VRT_CONCURRENCY is too high for the dev server.\n`,
        )
    }

    // GATE. Previously this always exited 0, so CI could never fail on a regression.
    // Fail on: unexpected pixel diffs, BROKEN (caption-as-subject) pairs, story errors, or a
    // comparison story that measured nothing. `data-vrt-expected` diffs are NOT failures.
    const failures = flagged.length + broken.length + errors.length + unmeasured.length
    if (failures) {
        console.log(
            `\n✗ FAIL — ${flagged.length} unexpected diff(s), ${broken.length} broken pair(s), ` +
                `${errors.length} error(s), ${unmeasured.length} unmeasured comparison story(ies).`,
        )
        console.log(`  Set VRT_SOFT=1 to report without failing (diagnostic mode).`)
        if (!process.env.VRT_SOFT) process.exitCode = 1
    } else {
        console.log(`\n✓ PASS`)
    }
}

run().catch((e) => {
    console.error(`\n✗ ${e.message}`)
    process.exit(1)
})
