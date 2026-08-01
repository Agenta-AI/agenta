/**
 * Parity gate — antd vs agenta, run inside a comparison story's iframe.
 *
 * Comparison stories render rows of `[label | antd | agenta]`. This diffs the computed
 * styles of the two columns and returns the rows that disagree.
 *
 * Paste into the devtools console on
 *   http://localhost:6006/iframe.html?id=<story-id>&viewMode=story&globals=theme:light
 * (and again with `theme:dark`), or drive it from an automated browser.
 *
 * IMPORTANT — why `killTransitions()` exists: our components use `transition-colors`. A
 * background/automated tab does not advance CSS animations, so after a theme switch every
 * transitioning element sits at `currentTime: 0` forever and `getComputedStyle` keeps
 * returning the pre-switch (light) value. Without this, dark mode reports a full column of
 * failures that do not exist. See antd-inventory/GOTCHAS.md.
 */

/** Freeze all transitions/animations so computed styles report their settled values. */
export function killTransitions() {
    const style = document.createElement("style")
    style.dataset.parityGate = "true"
    style.textContent = "*,*::before,*::after{transition:none !important;animation:none !important}"
    document.head.append(style)
    document.querySelectorAll("*").forEach((el) => el.getAnimations?.().forEach((a) => a.finish()))
    void document.body.offsetHeight
}

/** The properties a "no visual change" claim actually rests on. */
function snapshot(el) {
    const s = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const borderWidth = parseFloat(s.borderTopWidth)
    return {
        height: rect.height.toFixed(1),
        width: rect.width.toFixed(1),
        background: s.backgroundColor,
        color: s.color,
        borderWidth: s.borderTopWidth,
        // A zero-width border renders identically whatever its color/style is; comparing
        // them there produces noise (`border-0` vs antd's `border-style: none`).
        borderColor: borderWidth ? s.borderTopColor : "n/a",
        borderStyle: borderWidth ? s.borderTopStyle : "n/a",
        radius: s.borderTopLeftRadius,
        paddingLeft: s.paddingLeft,
        paddingTop: s.paddingTop,
        fontSize: s.fontSize,
        // Load-bearing: preflight is off, so native controls silently keep the UA font
        // (Arial on input/button, monospace on textarea). Colors and box metrics all match
        // while the text renders in the wrong typeface — this is how that shipped once.
        fontFamily: s.fontFamily,
    }
}

const SUBJECT =
    ".ant-input-affix-wrapper, .ant-input-outlined, button, textarea, input, span[class*=inline-flex]"

function subjectIn(cell) {
    return cell.querySelector(SUBJECT) ?? cell.firstElementChild
}

/**
 * @param {object} [options]
 * @param {string[]} [options.ignore] property names to skip (e.g. ["width"])
 * @returns {{theme: string, total: number, matched: number, mismatches: object[]}}
 */
export function measureParity({ignore = []} = {}) {
    killTransitions()

    const rows = [...document.querySelectorAll(".grid")]
    if (!rows.length) throw new Error("No comparison rows found — is the story still compiling?")

    const results = rows.map((row) => {
        const [labelCell, antdCell, agentaCell] = row.children
        const antd = subjectIn(antdCell)
        const agenta = subjectIn(agentaCell)
        const label = labelCell.innerText.trim()
        if (!antd || !agenta) return {label, diff: ["missing element in one column"]}

        const a = snapshot(antd)
        const b = snapshot(agenta)
        const diff = Object.keys(a)
            .filter((k) => !ignore.includes(k) && a[k] !== b[k])
            .map((k) => `${k}: antd=${a[k]} agenta=${b[k]}`)
        return {label, diff}
    })

    return {
        theme: document.documentElement.className,
        total: results.length,
        matched: results.filter((r) => !r.diff.length).length,
        mismatches: results.filter((r) => r.diff.length),
    }
}

/**
 * Measure a PORTALED overlay (dropdown / popover / menu) that renders into <body>, outside
 * the trigger — so `measureParity` (which only sees the trigger) structurally cannot check
 * it. This is where the serif-font-in-portal bug hid: content escapes the app font scope and
 * preflight-off makes <body> default to serif. Open each side, then diff a representative
 * child from each panel.
 *
 * @param {object} opts
 * @param {(el: Element) => void} opts.openAntd    open the antd control in a cell
 * @param {(el: Element) => void} opts.openAgenta  open the agenta control in a cell
 * @param {string} opts.antdItem      selector for an antd option/row (within document)
 * @param {string} opts.agentaItem    selector for an agenta option/row (within document)
 * @param {number} [opts.rowIndex=0]  which comparison row's controls to open
 */
export async function measureOverlayParity({
    openAntd,
    openAgenta,
    antdItem,
    agentaItem,
    rowIndex = 0,
}) {
    const row = [...document.querySelectorAll(".grid")][rowIndex]
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))

    openAntd(subjectIn(row.children[1]))
    await wait(350)
    const antd = document.querySelector(antdItem)
    const a = antd && snapshot(antd)
    // close antd before opening agenta so the two panels don't overlap
    document.body.click()
    await wait(150)

    openAgenta(subjectIn(row.children[2]))
    await wait(350)
    const agenta = document.querySelector(agentaItem)
    const b = agenta && snapshot(agenta)
    killTransitions()

    if (!a || !b) return {ok: false, error: "overlay item not found", a: !!a, b: !!b}
    const diff = Object.keys(a)
        .filter((k) => a[k] !== b[k])
        .map((k) => `${k}: antd=${a[k]} agenta=${b[k]}`)
    return {ok: diff.length === 0, diff, antd: a, agenta: b}
}

/**
 * Prove FOCUS parity for a row's two controls. `:focus` is real: calling `el.focus()` applies
 * the `:focus` pseudo-class, so `getComputedStyle` reflects the focus styles. (Hover cannot be
 * forced this way — the `:hover` pseudo needs a real cursor over the element, so drive hover
 * with the browser MCP `hover` action and call `snapshotEl` yourself.)
 *
 * @param {object} opts
 * @param {number} [opts.rowIndex=0]
 * @param {string} [opts.antdSel]   focusable element within the antd cell (default: the subject)
 * @param {string} [opts.shadSel]   focusable element within the agenta cell
 * @param {string[]} [opts.keys]    which snapshot keys to compare (default: border + bg + ring-ish)
 */
export function measureFocusParity({rowIndex = 0, antdSel, shadSel, keys} = {}) {
    const row = [...document.querySelectorAll(".grid")][rowIndex]
    const antd = antdSel ? row.children[1].querySelector(antdSel) : subjectIn(row.children[1])
    const shad = shadSel ? row.children[2].querySelector(shadSel) : subjectIn(row.children[2])
    if (!antd || !shad) return {ok: false, error: "focus target not found"}

    const read = (el) => {
        el.focus()
        killTransitions()
        const s = getComputedStyle(el)
        return {
            borderColor: s.borderTopColor,
            borderWidth: s.borderTopWidth,
            background: s.backgroundColor,
            outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
            boxShadow: s.boxShadow,
            isFocused: document.activeElement === el,
        }
    }
    const a = read(antd)
    const b = read(shad)
    const cmp = keys ?? Object.keys(a)
    const diff = cmp.filter((k) => a[k] !== b[k]).map((k) => `${k}: antd=${a[k]} agenta=${b[k]}`)
    return {ok: diff.length === 0, diff, antd: a, agenta: b}
}

/**
 * Measure INTERACTION-STATE parity from a forced-state story (storybook-addon-pseudo-states).
 * The states are rendered statically — a `pseudo-<state>-all` wrapper forces the pseudo-class
 * on antd and agenta identically — so this is a plain snapshot diff with NO cursor/keyboard and
 * NO OS-window-focus dependency (unlike measureFocusParity, which is now only a fallback).
 *
 * Each `.grid` row is `[label | antd-cell | agenta-cell]`; pass a selector for the control.
 * @param {string} [subjectSel="button, input, textarea, [data-slot$=trigger]"]
 */
export function measureForcedStates(subjectSel = "button, input, textarea, [data-slot$=trigger]") {
    killTransitions()
    // An outline is invisible (so not a real diff) when style=none or the colour is transparent.
    const ring = (s) =>
        s.outlineStyle === "none" || /rgba\(0, 0, 0, 0\)|transparent/.test(s.outlineColor)
            ? "none"
            : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} @${s.outlineOffset}`
    const shadow = (s) => (s.boxShadow === "none" ? "none" : s.boxShadow)
    const pick = (el) => {
        const s = getComputedStyle(el)
        const bw = parseFloat(s.borderTopWidth)
        return {
            background: s.backgroundColor,
            color: s.color,
            borderColor: bw ? s.borderTopColor : "n/a",
            ring: ring(s),
            boxShadow: shadow(s),
        }
    }
    return [...document.querySelectorAll(".grid")].map((row) => {
        const a = row.children[1].querySelector(subjectSel)
        const s = row.children[2].querySelector(subjectSel)
        const label = row.children[0].innerText.trim()
        if (!a || !s) return {label, diff: ["control not found"]}
        const A = pick(a)
        const B = pick(s)
        const diff = Object.keys(A)
            .filter((k) => A[k] !== B[k])
            .map((k) => `${k}: antd=${A[k]} agenta=${B[k]}`)
        return {label, diff: diff.length ? diff : "MATCH"}
    })
}

/** Snapshot one element (fallback for real-cursor hover; prefer measureForcedStates). */
export function snapshotEl(sel) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel
    if (!el) return null
    killTransitions()
    const s = getComputedStyle(el)
    return {
        background: s.backgroundColor,
        color: s.color,
        borderColor: parseFloat(s.borderTopWidth) ? s.borderTopColor : "n/a",
        boxShadow: s.boxShadow,
    }
}

/** Prove an element is NON-focusable (for Badge/Tag and other display-only components). */
export function assertNonFocusable(sel) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel
    if (!el) return {ok: false, error: "element not found"}
    const before = document.activeElement
    el.focus?.()
    const took = document.activeElement === el
    if (took) before?.focus?.()
    return {
        ok: !took && el.tabIndex < 0,
        focusable: took,
        tabIndex: el.tabIndex,
        outlineOnFocus: getComputedStyle(el).outlineStyle,
    }
}

// Convenience for a console paste.
if (typeof window !== "undefined") {
    window.measureParity = measureParity
    window.measureOverlayParity = measureOverlayParity
    window.measureForcedStates = measureForcedStates
    window.measureFocusParity = measureFocusParity
    window.snapshotEl = snapshotEl
    window.assertNonFocusable = assertNonFocusable
}
