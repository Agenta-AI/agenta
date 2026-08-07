/**
 * render-check — "did it render?", which is the question neither other gate asks.
 *
 *   node parity/render-check.mjs <story-id>...
 *   node parity/render-check.mjs                 # every id in ALL_IDS below
 *
 * ## Why this exists
 *
 * `vrt.mjs` answers "does the agenta half match the antd half?" and `a11y.mjs` answers "does
 * the rendered tree pass axe". Both are green on a story that renders **nothing**, and both
 * were green on a story that **crashed** — two real wave-3 defects proved it:
 *
 * - `VariableCard` threw ``Tooltip` must be used within `TooltipProvider``. The VRT read
 *   React's error overlay as "no pairs measured" and axe audited the overlay as one clean root.
 * - `ToolCallView` returned `null` because a fixture had the wrong shape. Green on an empty page.
 *
 * That blind spot got worse in the story-coverage backfill: those stories are showcases with no
 * antd half by decision, so the VRT contributes no pixel signal for them at all. This check is
 * their primary gate.
 *
 * ## What it asserts, per story id × light and dark
 *
 *   1. The story root exists.
 *   2. It has visible text (or, for portal-rendering stories, `document.body` does).
 *   3. No React error overlay and no error string in the root.
 *   4. No uncaught page error and no `console.error` during load.
 *
 * `EXPECT_EMPTY` below exempts stories whose empty render IS the subject — each needs a reason,
 * same rule as the VRT's `NO_PAIR_EXPECTED`. Do not add an id there to silence a real blank.
 */

import {chromium} from "playwright"

const URL = process.env.STORYBOOK_URL ?? "http://localhost:6006"
const THEMES = ["light", "dark"]

/**
 * Stories that legitimately render (almost) nothing. Reason required.
 * Their roots are still checked for crashes — only the "has text" assertion is relaxed.
 */
const EXPECT_EMPTY = new Map([
    [
        "agenta-playground-ui-turn-headeroptions--hidden-until-hover",
        "the toolbar is `invisible` until its turn is hovered — an empty strip is the subject",
    ],
    [
        "agenta-playground-ui-testsetselection-modal--closed",
        "open={false} keeps the content and all its testset queries unmounted",
    ],
])

/**
 * Console messages that are noise from the harness rather than a defect. Anything else logged
 * at error level fails the story.
 */
const IGNORED_CONSOLE = [
    /\[withAgentaData\]/,
    /Download the React DevTools/,
    /was preloaded using link preload/,
    /Support for defaultProps will be removed/,
    // Emitted BY the antd half of a parity story — pre-migration code, deprecated on purpose.
    // e.g. `[antd: Spin] size="default" is deprecated`.
    /Warning: \[antd: /,
]

/**
 * Uncaught rejections that are harness artifacts rather than component defects.
 *
 * `AbortError: The user aborted a request.` fires in DARK only, on stories rendering a
 * `VariableCard` whose value is not a string (the object/number branches lazy-load their view).
 * The theme decorator remounts once to apply the antd dark algorithm, cancelling the in-flight
 * chunk fetch. It carries no stack and no failed network request, and the story's rendered text
 * is byte-identical in both themes (537 chars either way for `inputs-bodyparts--body`), so the
 * component is fine. Recorded as an open finding rather than fixed here — narrow the pattern if
 * a real abort ever needs to fail.
 */
const IGNORED_PAGE_ERRORS = [/AbortError: The user aborted a request/]

const ERROR_MARKERS = [
    /^\s*Error:/m,
    /Uncaught \w*Error/,
    /must be used within/,
    /Cannot read propert/,
    /is not a function/,
    /Objects are not valid as a React child/,
]

/** Re-load a story and return its visible text. Used to distinguish a real blank from a
 *  dev-server rebuild that served an empty root. */
async function reloadAndReadText(page, url) {
    try {
        await page.goto(url, {waitUntil: "domcontentloaded", timeout: 60_000})
        await page.waitForSelector("#storybook-root", {state: "attached", timeout: 20_000})
        await page.waitForTimeout(2500)
        return await page.evaluate(() =>
            (
                (document.querySelector("#storybook-root")?.innerText ?? "") +
                (document.body.innerText ?? "")
            ).trim(),
        )
    } catch {
        return ""
    }
}

const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"))

if (ids.length === 0) {
    console.error("usage: node parity/render-check.mjs <story-id>...")
    process.exit(2)
}

const failures = []
const notes = []

const browser = await chromium.launch()
const page = await browser.newPage({viewport: {width: 1280, height: 900}})

for (const id of ids) {
    for (const theme of THEMES) {
        const consoleErrors = []
        const pageErrors = []
        const onConsole = (msg) => {
            if (msg.type() !== "error") return
            const text = msg.text()
            if (IGNORED_CONSOLE.some((re) => re.test(text))) return
            consoleErrors.push(text)
        }
        const onPageError = (err) => {
            const text = String(err)
            if (IGNORED_PAGE_ERRORS.some((re) => re.test(text))) return
            pageErrors.push(text)
        }
        page.on("console", onConsole)
        page.on("pageerror", onPageError)

        const url = `${URL}/iframe.html?id=${id}&globals=theme:${theme}&viewMode=story`
        try {
            // NOT networkidle — Storybook holds a websocket open, so it never fires.
            await page.goto(url, {waitUntil: "domcontentloaded", timeout: 60_000})
            // `attached`, not the default `visible` — an intentionally empty root is "hidden",
            // and treating that as a load failure would hide the real "rendered nothing" check
            // behind a timeout.
            await page.waitForSelector("#storybook-root", {
                state: "attached",
                timeout: 20_000,
            })
            // Let effects, portals and fixture-backed queries settle.
            await page.waitForTimeout(1200)
        } catch (e) {
            failures.push(`${id} [${theme}] — did not load: ${e.message}`)
            page.off("console", onConsole)
            page.off("pageerror", onPageError)
            continue
        }

        const {rootText, bodyText, hasOverlay} = await page.evaluate(() => {
            const el = document.querySelector("#storybook-root")
            return {
                rootText: (el?.innerText ?? "").trim(),
                bodyText: (document.body.innerText ?? "").trim(),
                // Storybook/Next render runtime errors into an overlay outside the root.
                hasOverlay: Boolean(
                    document.querySelector("nextjs-portal, #nextjs__container_errors_label"),
                ),
            }
        })

        page.off("console", onConsole)
        page.off("pageerror", onPageError)

        const expectEmpty = EXPECT_EMPTY.has(id)
        const visible = rootText.length > 0 || bodyText.length > 0

        if (hasOverlay) failures.push(`${id} [${theme}] — Next.js error overlay present`)
        if (pageErrors.length)
            failures.push(`${id} [${theme}] — uncaught: ${pageErrors[0].slice(0, 200)}`)
        if (consoleErrors.length)
            failures.push(`${id} [${theme}] — console.error: ${consoleErrors[0].slice(0, 200)}`)

        const marker = ERROR_MARKERS.find((re) => re.test(rootText))
        if (marker)
            failures.push(`${id} [${theme}] — error text in root: ${rootText.slice(0, 160)}`)

        if (!visible && !expectEmpty) {
            // Retry once before calling it a blank. On the dev server a story loaded while
            // webpack is still rebuilding serves an empty root — indistinguishable from a real
            // "renders nothing", and it produced a false failure the first time this ran.
            // `vrt.mjs` retries navigation for the same reason.
            const retried = await reloadAndReadText(page, url)
            if (retried.length === 0)
                failures.push(`${id} [${theme}] — rendered nothing (no text in root or body)`)
            else
                notes.push(
                    `${id} [${theme}] — empty on first load, fine on retry (dev-server rebuild)`,
                )
        }

        if (expectEmpty && visible && rootText.length > 400)
            notes.push(
                `${id} [${theme}] — listed in EXPECT_EMPTY but rendered ${rootText.length} chars; re-check the exemption`,
            )
    }
}

await browser.close()

for (const [id, reason] of EXPECT_EMPTY) {
    if (ids.includes(id)) console.log(`ℹ EXPECTED EMPTY ${id} — ${reason}`)
}
for (const note of notes) console.log(`⚠ ${note}`)

if (failures.length) {
    console.error(`\n✗ FAIL — ${failures.length} problem(s) across ${ids.length} stories:`)
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
}

console.log(`\n✓ PASS — ${ids.length} stories rendered in both themes`)
