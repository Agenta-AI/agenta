/**
 * Accessibility audit — runs axe-core against the @agenta/ui half of each component story.
 * Complements the VRT (which checks pixels): this checks ARIA roles/names/states/structure,
 * plus colour contrast. Scoped to the agenta subtree so antd's own markup doesn't pollute
 * results.
 *
 * Usage (Storybook must be running on :6006):
 *   node parity/a11y.mjs                   # gate: non-zero exit on any failure
 *   A11Y_SOFT=1 node parity/a11y.mjs       # diagnostic: report without failing
 *   STORYBOOK_URL=http://localhost:6006 node parity/a11y.mjs
 */
import {createRequire} from "node:module"

import {chromium} from "playwright"

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve("axe-core/axe.min.js")
const URL = process.env.STORYBOOK_URL ?? "http://localhost:6006"
// A cold dev server pays a full compile on the first load of a story graph and routinely
// blows past a short timeout. Retrying turns that starvation artifact back into a real
// audit instead of a spurious error (the VRT learned the same lesson).
const RETRIES = 2

// component → the story that renders the @agenta/ui component fully. `open` = a trigger selector to
// CLICK first: overlays must be audited in their NATURAL (Radix-managed) open state, not the
// forced-open `defaultOpen`+inline-container OpenState stories (those are for VRT pixel-diffing;
// forcing them open inline leaves an inert wrapper Radix would otherwise manage, which trips
// `aria-hidden-focus` — an artifact, not a defect; proven by auditing the natural open here).
const STORIES = [
    {id: "agenta-ui-primitives-forms-button--antd-vs-agenta"},
    {id: "agenta-ui-primitives-forms-input--antd-vs-agenta"},
    {id: "agenta-ui-primitives-forms-select--antd-vs-agenta", open: "[data-slot=select-trigger]"},
    {id: "agenta-ui-primitives-forms-combobox--open-state"},
    {id: "agenta-ui-primitives-overlays-tooltip--open-state"},
    {id: "agenta-ui-primitives-forms-switch--antd-vs-agenta"},
    {id: "agenta-ui-primitives-forms-radio--antd-vs-agenta"},
    {id: "agenta-ui-primitives-forms-checkbox--antd-vs-agenta"},
    {id: "agenta-ui-primitives-display-alert--antd-vs-agenta"},
    {id: "agenta-ui-primitives-display-divider--antd-vs-agenta"},
    {
        id: "agenta-ui-primitives-overlays-dropdown--antd-vs-agenta",
        open: "[data-slot=dropdown-menu-trigger]",
    },
    {id: "agenta-ui-primitives-display-tabs--antd-vs-agenta"},
    {id: "agenta-ui-primitives-display-collapse--antd-vs-agenta"},
    {id: "agenta-ui-primitives-feedback-skeleton--antd-vs-agenta"},
    {id: "agenta-ui-primitives-feedback-spinner--antd-vs-agenta"},
    {
        id: "agenta-ui-primitives-overlays-dialog--antd-vs-agenta",
        open: "[data-slot=dialog-trigger]",
    },
    {
        id: "agenta-ui-primitives-overlays-alertdialog--antd-vs-agenta",
        open: "[data-slot=alert-dialog-trigger]",
    },
    {id: "agenta-ui-primitives-overlays-sheet--antd-vs-agenta", open: "[data-slot=sheet-trigger]"},
    {id: "agenta-ui-primitives-feedback-progress--antd-vs-agenta"},
    {id: "agenta-ui-primitives-forms-segmented--antd-vs-agenta"},
    {id: "agenta-ui-primitives-display-avatar--antd-vs-agenta"},
    {id: "agenta-ui-primitives-forms-field--antd-vs-agenta"},
    {id: "agenta-ui-primitives-display-breadcrumb--antd-vs-agenta"},
    {id: "agenta-ui-primitives-display-emptystate--antd-vs-agenta"},
    // entity-ui wave 1 — composite components, audited on their agenta half (parity stories)
    // or their natural rendered state (data-seam showcases).
    {id: "agenta-entity-ui-drawers-additemmenu--antd-vs-agenta"},
    {id: "agenta-entity-ui-drawers-drawerfooter--antd-vs-agenta"},
    {id: "agenta-entity-ui-drawers-masterdetailrail--antd-vs-agenta"},
    {id: "agenta-entity-ui-drawers-railfield--antd-vs-agenta"},
    {id: "agenta-entity-ui-drawers-sectionrail--antd-vs-agenta"},
    {id: "agenta-entity-ui-gatewaytool-connectionstatusbadge--antd-vs-agenta"},
    {id: "agenta-entity-ui-gatewaytool-resultviewer--antd-vs-agenta"},
    {id: "agenta-entity-ui-gatewaytool-schemaform--antd-vs-agenta"},
    {id: "agenta-entity-ui-gatewaytrigger-activetoggle--antd-vs-agenta"},
    {id: "agenta-entity-ui-gatewaytrigger-eventsourcepicker--open-state"},
    {id: "agenta-entity-ui-gatewaytrigger-messagecomposer--antd-vs-agenta"},
    {id: "agenta-entity-ui-gatewaytrigger-runbuttons--antd-vs-agenta"},
    {id: "agenta-entity-ui-gatewaytrigger-schedulebuilderfield--antd-vs-agenta"},
    {id: "agenta-entity-ui-gatewaytrigger-windowfield--antd-vs-agenta"},
    {id: "agenta-entity-ui-modals-entitycommitmodal--clean-revision"},
    {id: "agenta-entity-ui-modals-entitydeletemodal--default"},
    {id: "agenta-entity-ui-modals-entitysavemodal--save-existing"},
    {id: "agenta-entity-ui-modals-loadevaluatorpresetmodal--default"},
    {id: "agenta-entity-ui-secretprovider-customproviderform--new-provider"},
    {id: "agenta-entity-ui-secretprovider-modelnameinput--antd-vs-agenta"},
    {id: "agenta-entity-ui-selection-entityselectormodal--open"},
    {id: "agenta-entity-ui-selection-unifiedentitypicker--cascading"},
    {id: "agenta-entity-ui-selection-unifiedentitypicker--breadcrumb"},
    {id: "agenta-entity-ui-shared-entitytable--multi-select"},
    {id: "agenta-entity-ui-shared-runnableoutputvalue--antd-vs-agenta"},
    {id: "agenta-entity-ui-templateformat-templateformatpicker--antd-vs-agenta"},
    {id: "agenta-entity-ui-testcase-testcasedrawer--default"},
    {id: "agenta-entity-ui-variant-environmentstatus--antd-vs-agenta"},
    {id: "agenta-entity-ui-variant-variantdetails--antd-vs-agenta"},
    {id: "agenta-entity-ui-viewtypes-formview--antd-vs-agenta"},
    {id: "agenta-entity-ui-workflow-workflowkindtag--antd-vs-agenta"},
    {id: "agenta-entity-ui-workflow-workflowtypetag--antd-vs-agenta"},
]

// Per-story runs: `node parity/a11y.mjs <story-id>...` audits just those ids (registered
// entries keep their `open` config; unknown ids run bare). Mirrors the VRT's argv contract.
const argvIds = process.argv.slice(2)
const SELECTED = argvIds.length
    ? argvIds.map((id) => STORIES.find((s) => s.id === id) ?? {id})
    : STORIES

/**
 * DECLARED, UNGATED deviations — reported every run so they stay visible, but not failures.
 * Mirrors the VRT's `data-vrt-expected`: a known deliberate difference should be loud, not
 * silently suppressed by disabling the rule for everyone.
 *
 * A node matches when its rule id AND its `data-slot` both match, in the listed story. Anything
 * else is a real failure — so a NEW contrast break in the same component still fails the run.
 *
 * All four entries below are the SAME finding: antd's `colorTextDescription` (#758391) and
 * `colorTextPlaceholder` (#bdc7d1) fail AA on white, and we reproduce antd's tokens exactly.
 * Verified by auditing the antd half of each story — it fails the identical node count at the
 * identical ratio. Fixing any of them means recolouring the component (these are not sub-AA
 * shades we chose, they ARE the token), which breaks the VRT's 1% pixel gate. The real fix is a
 * palette-level change to `text.description`/`text.placeholder` in palette.ts, which recolours
 * the whole app — an owner decision, not a harness one.
 */
const EXPECTED = [
    {
        story: "agenta-ui-primitives-display-avatar--antd-vs-agenta",
        rule: "color-contrast",
        slot: "avatar-text",
        reason:
            "antd's own Avatar colours: #ffffff on colorTextPlaceholder #bdc7d1 = 1.71:1. The antd half " +
            "of this story fails the same 7 nodes at the same ratio, so this is inherited, not a port defect.",
    },
    {
        story: "agenta-ui-primitives-display-breadcrumb--antd-vs-agenta",
        rule: "color-contrast",
        slot: "breadcrumb-link",
        reason:
            "antd Breadcrumb's non-final link colour colorTextDescription #758391 on white = 3.88:1. " +
            "antd half fails the same 6 nodes at the same ratio.",
    },
    {
        story: "agenta-ui-primitives-display-emptystate--antd-vs-agenta",
        rule: "color-contrast",
        slot: "empty-state-description",
        reason:
            "antd Empty's description token colorTextDescription #758391 on white = 3.88:1. " +
            "antd half fails the same 4 nodes at the same ratio.",
    },
    {
        story: "agenta-ui-primitives-forms-field--antd-vs-agenta",
        rule: "color-contrast",
        slot: "field-description",
        reason:
            "antd Form description colour colorTextDescription #758391 on white = 3.88:1. " +
            "antd half fails the same 1 node at the same ratio.",
    },
    // entity-ui wave 1: token-inherited contrast, declared story-wide (no slot to key on).
    {
        story: "agenta-entity-ui-drawers-drawerfooter--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drawers-masterdetailrail--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-gatewaytool-connectionstatusbadge--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-gatewaytrigger-eventsourcepicker--open-state",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-gatewaytrigger-messagecomposer--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-gatewaytrigger-schedulebuilderfield--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-gatewaytrigger-windowfield--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-modals-entitycommitmodal--clean-revision",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-selection-entityselectormodal--open",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-selection-unifiedentitypicker--cascading",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-selection-unifiedentitypicker--breadcrumb",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-shared-entitytable--multi-select",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-shared-runnableoutputvalue--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drillin-parametertree--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drillin-parameternodeeditor--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drillin-buildkitsection--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drillin-providerkeyfield--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drillin-providercredentialssection--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drillin-permissionpolicyselect--open-state",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drillin-agenttemplatecontrol--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drillin-itemrow--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-drillin-agentintegrationdrawer--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-secretprovider-customproviderform--new-provider",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
    {
        story: "agenta-entity-ui-variant-variantdetails--antd-vs-agenta",
        rule: "color-contrast",
        reason:
            "inherited antd tokens (colorTextTertiary/colorTextDescription #758391, preset tag pairs, warning/success tokens) reproduced exactly; " +
            "palette-level decision, not a component defect (see the note above EXPECTED).",
    },
]

/**
 * Contrast waivers keyed on the MEASURED COLOURS, not on the story.
 *
 * 469 nodes across 152 stories fail `color-contrast`, and a per-story waiver list would have
 * to name most of the inventory — at which point it stops being a gate. Keying on the actual
 * foreground (and background, where the foreground alone is ambiguous) waives the specific
 * palette decisions we have already made and nothing else: a NEW sub-AA colour is a colour
 * that appears in no list below, so it still fails.
 *
 * Every entry was verified against the rendered DOM; the categories are deliberately separate
 * so the reason stays legible and each stays independently actionable.
 */
const CONTRAST_WAIVERS = [
    // 1. Muted text tokens. antd's own colorTextDescription/colorTextTertiary (#758391) and
    //    colorTextPlaceholder (#bdc7d1), their dark-mode flattenings, and the gray/zinc scale
    //    text shades. Sub-AA by palette design, app-wide; fixing means recolouring the app,
    //    which is an owner decision in palette.ts, not a harness one.
    {
        fg: [
            "#758391",
            "#bdc7d1",
            "#97a4b0",
            "#8f979f",
            "#9ea8b2",
            "#9ba3ab",
            "#a1a1aa",
            "#71717a",
            "#6b7280",
            "#838383",
            "#6d6d6d",
            "#888888",
            "#8d8d8d",
            "#878787",
            "#5e5e5e",
            "#5d5d5d",
            "#535353",
            "#b9b9b9",
            "#979ca6",
            // --ag-c-667085 and its 75%-alpha shade. Raw shim hexes that predate wave 3 —
            // TypingIndicator's label and NodeNameTag's version suffix both used them on the
            // antd side too, so they are a palette decision, not a migration regression.
            "#667085",
            // #667085 at 75% alpha composited on colorBgContainer — TypingIndicator's label.
            "#8c94a4",
            // --ag-rgba-051729-55 (#051729 at 55%) composited on white → measured 4.07:1.
            // UnreferencedColumnsFooter's summary line. The pre-migration body carried the
            // identical `!text-[var(--ag-rgba-051729-55)]` class on its antd Button, so this is
            // a palette token predating wave 3, not a swap regression.
            "#757f89",
            // Pure #ff0000 — the CSS keyword `red`, hardcoded in SharedEditor's error state
            // (`!text-[red]`, SharedEditorImpl.tsx:431). Measured 3.99:1 on white / 3.69:1 on
            // #f5f6f6, and it is a raw keyword so it does NOT adapt to dark. Pre-existing and
            // app-wide, not a wave-3 swap. Waived here rather than restyled inside a
            // story-coverage change; see finding WAVE3-F26 for the one-line fix.
            "#ff0000",
        ],
        reason: "muted text token (antd colorTextDescription/Placeholder + gray scales) — sub-AA by palette design",
    },
    // 2. antd preset semantic pairs: the tag/alert colour on its own tinted background. We
    //    reproduce antd's pairs exactly, and the antd half of each parity story fails these
    //    same nodes at the same ratio.
    {
        fg: [
            "#389e0d",
            "#1677ff",
            "#08979c",
            "#642ab5",
            "#faad14",
            "#d61010",
            "#dc4446",
            "#1668dc",
            "#237804",
            "#874d00",
            "#d46b08",
            "#13c2c2",
            // draftTag gold (#d48806 on #fffbe6) — the palette's draftTag family, reproduced
            // exactly by Badge variant="draft" (see the DraftTag migration note in STATUS.md).
            "#d48806",
        ],
        reason: "antd preset semantic pair (tag/alert foreground on its tinted background)",
    },
    // 3. White on a hardcoded VENDOR BRAND colour (Claude Code #d97757, harness kinds
    //    #0d9488/#56b4ac). Not antd, not introduced by the migration — these hexes predate it
    //    in HarnessSelectControl/itemDescriptors. Waived as a product/brand decision, and
    //    listed separately so it stays visible as its own follow-up.
    {
        fg: ["#ffffff"],
        bg: ["#0d9488", "#d97757", "#56b4ac", "#979ca6", "#0f6e65", "#515660", "#a375f2"],
        reason: "white on a hardcoded vendor brand colour — pre-existing product decision",
    },
]

const isWaivedContrast = (node) => {
    if (!node?.fg) return null
    const fg = String(node.fg).toLowerCase()
    const bg = String(node.bg ?? "").toLowerCase()
    return CONTRAST_WAIVERS.find((w) => w.fg.includes(fg) && (!w.bg || w.bg.includes(bg)))
}

const isExpected = (storyId, rule, slot) =>
    EXPECTED.find(
        (e) => e.story === storyId && e.rule === rule && (e.slot ? e.slot === slot : true),
    )

/** Audit one story. Returns {roots, rulesRun, violations} or {error}. */
async function auditOne(page, {id, open, waitFor}) {
    let lastError = null
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
            await page.goto(`${URL}/iframe.html?id=${id}&globals=theme:light&viewMode=story`, {
                waitUntil: "domcontentloaded",
                timeout: 120_000,
            })
            // Open stories may have no .grid — wait for their trigger instead. Data-seam
            // showcases (modals/drawers portaled to body, plain tables/forms) have neither
            // grid nor compare marker, so accept their overlay/subject roots too.
            // waitForSelector pins on the FIRST DOM match — Storybook's permanently-mounted
            // (hidden) error overlay contains a <table>, so a comma list can wait forever on a
            // hidden node. Wait for any VISIBLE candidate instead. Visibility must be
            // getClientRects(), not offsetParent: position:fixed overlays (sheets/dialogs)
            // have offsetParent === null while fully visible.
            const readySel =
                waitFor ||
                open ||
                ".grid, [data-open-compare], [data-slot=dialog-content], [data-slot=sheet-content], [data-slot=alert-dialog-content], [data-vrt-subject], form, table"
            const visibleMatch = (sel) =>
                [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0)
            // Two-stage wait. Showcase stories render plain markup that matches none of the
            // layout selectors above, so waiting only on those burns the full timeout on every
            // one of them; falling back to "the story root rendered something visible" keeps
            // them auditable. The specific wait goes first (and stays short) so a parity story
            // is never audited before its grid exists.
            try {
                await page.waitForFunction(visibleMatch, readySel, {timeout: 8_000})
            } catch {
                await page.waitForFunction(
                    () =>
                        [...(document.querySelector("#storybook-root")?.children ?? [])].some(
                            (el) => el.getClientRects().length > 0,
                        ),
                    null,
                    {timeout: 15_000},
                )
            }
            await page.waitForTimeout(300)
            if (open) {
                await page.locator(open).first().click() // natural, Radix-managed open
                await page.waitForTimeout(300)
            }
            await page.addScriptTag({path: AXE_PATH})
            return await page.evaluate(async () => {
                // An overlay opened naturally (portaled to <body>) → audit that content; else the
                // agenta side of the story (open-compare column, or every .grid row's agenta cell).
                const overlay = document.querySelector(
                    "[data-slot=select-content], [data-slot=dropdown-menu-content], [data-slot=dialog-content], [data-slot=sheet-content], [data-slot=alert-dialog-content]",
                )
                const oc = document.querySelector("[data-open-compare]")
                let context = overlay
                    ? [overlay]
                    : oc
                      ? [oc.children[1]]
                      : [...document.querySelectorAll(".grid")]
                            .map((r) => r.children[2])
                            .filter(Boolean)
                // Showcase stories (no parity layout at all) audit the whole story root.
                if (!context.length) {
                    const root = document.querySelector("#storybook-root")
                    if (root) context = [root]
                }
                // color-contrast is ON. It used to be disabled on the grounds that "the palette is
                // matched 1:1 to antd" — no longer true: `presetTag` in palette.ts deliberately
                // steps 5 of its 16 tag pairs down antd's ramp to reach WCAG AA. A palette that
                // diverges on purpose has to be checked, not assumed. Known-unfixable surfaces are
                // declared in EXPECTED (ungated but reported), not silenced rule-wide.
                // eslint-disable-next-line no-undef
                const r = await axe.run(context, {
                    resultTypes: ["violations"],
                })
                return {
                    // 0 roots = nothing was ever handed to axe. Without this, "clean" and
                    // "never audited" are the same output — the exact hole the VRT had.
                    roots: context.length,
                    // Proof axe actually evaluated rules against real nodes, so a story that
                    // renders an empty shell can't pass as "0 violations".
                    rulesRun:
                        r.violations.length +
                        r.passes.length +
                        r.incomplete.length +
                        r.inapplicable.length,
                    violations: r.violations.map((v) => ({
                        id: v.id,
                        impact: v.impact,
                        help: v.help,
                        // EVERY node, not axe's printed first-3: the summary under-reports scope.
                        nodes: v.nodes.map((n) => {
                            const sel = n.target.join(" ")
                            const el = document.querySelector(sel)
                            // color-contrast carries the measured colours; keep them so an
                            // inherited-token waiver can key on the actual foreground rather
                            // than on the story, which would waive real regressions too.
                            const cc = v.id === "color-contrast" ? n.any?.[0]?.data : null
                            return {
                                target: sel,
                                slot: el?.getAttribute?.("data-slot") ?? null,
                                text: (el?.textContent || "").trim().slice(0, 30),
                                fg: cc?.fgColor ?? null,
                                bg: cc?.bgColor ?? null,
                                ratio: cc?.contrastRatio ?? null,
                            }
                        }),
                    })),
                }
            })
        } catch (err) {
            lastError = err
        }
    }
    return {error: lastError?.message ?? "unknown failure"}
}

// One browser cannot survive a full sweep: each story loads a heavy bundle, memory climbs,
// and Chromium eventually dies — after which every page call hangs on a dead connection
// instead of throwing, so the run wedges at 0% CPU. Recycle on a fixed interval.
const STORIES_PER_BROWSER = 25

async function run() {
    let browser = await chromium.launch()
    let page = await browser.newPage()
    const all = []
    let sinceLaunch = 0
    for (const story of SELECTED) {
        if (sinceLaunch >= STORIES_PER_BROWSER) {
            await browser.close().catch(() => {})
            browser = await chromium.launch()
            page = await browser.newPage()
            sinceLaunch = 0
        }
        sinceLaunch++
        let res
        try {
            res = await auditOne(page, story)
        } catch (e) {
            // A dead browser surfaces here; relaunch once and retry this story.
            await browser.close().catch(() => {})
            browser = await chromium.launch()
            page = await browser.newPage()
            sinceLaunch = 1
            res = await auditOne(page, story).catch((e2) => ({error: e2.message}))
        }
        all.push({id: story.id, ...res})
    }
    await browser.close().catch(() => {})

    console.log(`\naxe a11y audit — @agenta/ui half of ${SELECTED.length} stories (light)\n`)

    const errors = []
    const unaudited = []
    let gated = 0
    const expectedHits = []

    for (const res of all) {
        const short = res.id.replace(/^antd-/, "")
        if (res.error) {
            console.log(`✗ ${short}: ERROR ${res.error.split("\n")[0]}`)
            errors.push(res)
            continue
        }
        // Rendered but audited nothing. Distinct from a clean pass, and NOT a pass.
        if (!res.roots || !res.rulesRun) {
            console.log(
                `🚨 ${short}: audited NOTHING (${res.roots} root(s), ${res.rulesRun} rule(s) run)`,
            )
            unaudited.push(res)
            continue
        }

        const lines = []
        let storyGated = 0
        for (const v of res.violations) {
            const gatedNodes = v.nodes.filter(
                (n) =>
                    !isExpected(res.id, v.id, n.slot) &&
                    !(v.id === "color-contrast" && isWaivedContrast(n)),
            )
            const waived = v.nodes.length - gatedNodes.length
            if (waived) {
                // A node can be waived by an EXPECTED entry or by a colour waiver; report
                // whichever actually matched so the reason shown is the real one.
                const e =
                    v.nodes.map((n) => isExpected(res.id, v.id, n.slot)).find(Boolean) ??
                    (v.id === "color-contrast" ? v.nodes.map(isWaivedContrast).find(Boolean) : null)
                expectedHits.push({id: res.id, rule: v.id, e, n: waived})
            }
            if (!gatedNodes.length) continue
            storyGated += gatedNodes.length
            lines.push(
                `    [${v.impact}] ${v.id} — ${v.help} (${gatedNodes.length} node${gatedNodes.length > 1 ? "s" : ""})`,
            )
            // Print the measured colours for a gated contrast node. Without them the only way
            // to write an honest waiver is to re-measure by hand in the browser — and the
            // wave-3 record shows the first draft of an unmeasured waiver is usually wrong.
            for (const n of gatedNodes.slice(0, 5))
                lines.push(
                    n.fg
                        ? `        ${n.target}\n            fg ${n.fg} on bg ${n.bg} — ratio ${n.ratio}`
                        : `        ${n.target}`,
                )
            if (gatedNodes.length > 5) lines.push(`        … ${gatedNodes.length - 5} more`)
        }
        gated += storyGated
        if (storyGated) {
            console.log(`⚠ ${short}:`)
            for (const l of lines) console.log(l)
        } else {
            console.log(`✓ ${short}  (${res.roots} root(s), ${res.rulesRun} rules)`)
        }
    }

    if (expectedHits.length) {
        console.log(
            `\nℹ ${expectedHits.length} declared/ungated violation group(s) (see EXPECTED):`,
        )
        for (const h of expectedHits) {
            const where = h.e?.slot ? ` @ [data-slot=${h.e.slot}]` : ""
            console.log(`   ${h.rule} × ${h.n}${where}  ${h.id}`)
            console.log(`      ${h.e?.reason ?? "waived"}`)
        }
    }
    if (errors.length) {
        console.log(`\n✗ ${errors.length} story error(s):`)
        for (const e of errors) console.log(`   ${e.id}: ${e.error.split("\n")[0]}`)
    }
    if (unaudited.length) {
        console.log(`\n🚨 ${unaudited.length} story(ies) audited ZERO nodes — not a pass:`)
        for (const u of unaudited) console.log(`   ${u.id}`)
        console.log(
            `   Causes: the story failed to render, or its .grid/[data-open-compare] layout changed.`,
        )
    }

    // GATE. Previously this always exited 0 AND counted a story error as a non-event, so a run
    // in which every story blew up still printed "✓ no violations" and passed.
    const failures = gated + errors.length + unaudited.length
    if (failures) {
        console.log(
            `\n✗ FAIL — ${gated} violating node(s), ${errors.length} story error(s), ` +
                `${unaudited.length} unaudited story(ies).`,
        )
        console.log(`  Set A11Y_SOFT=1 to report without failing (diagnostic mode).`)
        if (!process.env.A11Y_SOFT) process.exitCode = 1
    } else {
        console.log(`\n✓ PASS — no violations across ${all.length} stories`)
    }
}

run().catch((e) => {
    console.error(`\n✗ ${e.message}`)
    process.exit(1)
})
