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
]

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
]

const isExpected = (storyId, rule, slot) =>
    EXPECTED.find((e) => e.story === storyId && e.rule === rule && e.slot && e.slot === slot)

/** Audit one story. Returns {roots, rulesRun, violations} or {error}. */
async function auditOne(page, {id, open}) {
    let lastError = null
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
            await page.goto(`${URL}/iframe.html?id=${id}&globals=theme:light&viewMode=story`, {
                waitUntil: "domcontentloaded",
                timeout: 120_000,
            })
            // Open stories may have no .grid — wait for their trigger instead.
            await page.waitForSelector(open || ".grid, [data-open-compare]", {timeout: 30_000})
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
                const context = overlay
                    ? [overlay]
                    : oc
                      ? [oc.children[1]]
                      : [...document.querySelectorAll(".grid")]
                            .map((r) => r.children[2])
                            .filter(Boolean)
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
                            return {
                                target: sel,
                                slot: el?.getAttribute?.("data-slot") ?? null,
                                text: (el?.textContent || "").trim().slice(0, 30),
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

async function run() {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    const all = []
    for (const story of STORIES) {
        all.push({id: story.id, ...(await auditOne(page, story))})
    }
    await browser.close()

    console.log(`\naxe a11y audit — @agenta/ui half of ${STORIES.length} stories (light)\n`)

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
            const gatedNodes = v.nodes.filter((n) => !isExpected(res.id, v.id, n.slot))
            const waived = v.nodes.length - gatedNodes.length
            if (waived) {
                const e = v.nodes.map((n) => isExpected(res.id, v.id, n.slot)).find(Boolean)
                expectedHits.push({id: res.id, rule: v.id, e, n: waived})
            }
            if (!gatedNodes.length) continue
            storyGated += gatedNodes.length
            lines.push(
                `    [${v.impact}] ${v.id} — ${v.help} (${gatedNodes.length} node${gatedNodes.length > 1 ? "s" : ""})`,
            )
            for (const n of gatedNodes.slice(0, 5)) lines.push(`        ${n.target}`)
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
            console.log(`   ${h.rule} × ${h.n} @ [data-slot=${h.e.slot}]  ${h.id}`)
            console.log(`      ${h.e.reason}`)
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
