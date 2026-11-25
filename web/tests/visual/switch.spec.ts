import {mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"

import {test, type Page} from "@playwright/test"

import {requireEnv} from "./recipe"

/**
 * Session switch timing. A measurement, not a test: it asserts nothing and never runs in CI.
 * Run it on demand against a production build (`next build` + `next start`), alone on its machine.
 *
 *   APP_URL=<origin> QA_EMAIL=... QA_PASSWORD=... SWITCH_CASES=<cases.json> OUT=<dir> [RUNS=5] \
 *     pnpm --filter agenta-web-tests exec playwright test -c visual/playwright.visual.config.ts switch.spec.ts
 *
 * SWITCH_CASES is a JSON file: {"origin": Target, "sameAgent": Target, "otherAgent": Target},
 * where Target is {"id": "<session id>", "marker": "<text in the last turn of that session>"}.
 * "origin" and "sameAgent" belong to one agent, "otherAgent" to another one.
 *
 * Optional: CPU_THROTTLE=<factor> slows the CPU through the DevTools protocol; PANEL=builder (or
 * configuration, files) opens that right panel content first, so two conversations can be on screen.
 *
 * One run writes OUT/switch-<time>.json with the cases warm_same_agent, warm_other_agent and cold_same_agent.
 * The file keeps request paths, project ids and the start of each request body (chat text of the
 * test account included): keep it with the test evidence, do not share it outside the team.
 *
 * Click to done: the later of (a) one frame after the target turn shows the marker and (b) the end of
 * the last long task. The 300 ms with no long task that confirms the end is not counted.
 * The marker is read in the page conversation only ([data-conversation-role="page"]), never in the
 * builder panel's conversation.
 */

interface Target {
    id: string
    marker: string
}
interface Cases {
    origin: Target
    sameAgent: Target
    otherAgent: Target
}

const RUNS = Number(process.env.RUNS ?? 5)
/** Chrome CPU slow-down factor (1 = none). A fast measuring machine hides main-thread costs. */
const CPU_THROTTLE = Number(process.env.CPU_THROTTLE ?? 1)
/** Right panel content open during the run: "builder", "configuration", "files", or empty for closed. */
const PANEL = process.env.PANEL ?? ""
const COLD_SETTLE_MS = 6_000
const WARM_SETTLE_MS = 3_500
const out = process.env.OUT ?? ""
const authFile = `${out}/.auth.json`

/** Every fetch and XHR, on the page clock, with method and body. Installed before the app runs. */
const recorderScript = () => {
    interface Req {
        method: string
        url: string
        body: string
        start: number
        end: number | null
        status: number
    }
    const reqs: Req[] = []
    ;(window as unknown as {__switchRequests: Req[]}).__switchRequests = reqs
    const bodyText = (b: unknown) =>
        typeof b === "string" ? b : b ? `[${Object.prototype.toString.call(b)}]` : ""
    const origFetch = window.fetch
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const method = (
            init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase()
        const r: Req = {
            method,
            url,
            body: bodyText(init?.body),
            start: performance.now(),
            end: null,
            status: 0,
        }
        reqs.push(r)
        const p = origFetch.apply(this, [input, init] as Parameters<typeof fetch>)
        p.then(
            (res) => {
                r.end = performance.now()
                r.status = res.status
            },
            () => {
                r.end = performance.now()
                r.status = -1
            },
        )
        return p
    }
    const origOpen = XMLHttpRequest.prototype.open
    const origSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (
        this: XMLHttpRequest & {__req?: Req},
        method: string,
        url: string | URL,
    ) {
        this.__req = {
            method: method.toUpperCase(),
            url: String(url),
            body: "",
            start: 0,
            end: null,
            status: 0,
        }
        // eslint-disable-next-line prefer-rest-params
        return origOpen.apply(this, arguments as unknown as Parameters<typeof origOpen>)
    } as typeof origOpen
    XMLHttpRequest.prototype.send = function (
        this: XMLHttpRequest & {__req?: Req},
        body?: Document | XMLHttpRequestBodyInit | null,
    ) {
        const r = this.__req
        if (r) {
            r.body = bodyText(body)
            r.start = performance.now()
            reqs.push(r)
            this.addEventListener("loadend", () => {
                r.end = performance.now()
                r.status = this.status
            })
        }
        return origSend.call(this, body)
    }
}

/** The in-page probe: click the target's sidebar row and time the switch. */
const probe = async ({id: target, marker}: Target) => {
    const QUIET = 300
    const TIMEOUT = 20_000
    const link = [
        ...document.querySelectorAll<HTMLAnchorElement>(`a[href*="/sessions/${target}"]`),
    ].find((a) => a.offsetParent !== null)
    if (!link) return {error: `no visible sidebar link for ${target}`}
    const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()
    const targetTurnText = () => {
        const roots = document.querySelectorAll('[data-conversation-role="page"]')
        for (const root of roots) {
            const turns = root.querySelectorAll(".ag-turn")
            if (turns.length) return norm(turns[turns.length - 1].textContent)
        }
        return ""
    }
    const wanted = norm(marker)
    const longtasks: {start: number; end: number}[] = []
    const loafs: PerformanceEntry[] = []
    const lt = new PerformanceObserver((l) =>
        l
            .getEntries()
            .forEach((e) => longtasks.push({start: e.startTime, end: e.startTime + e.duration})),
    )
    lt.observe({type: "longtask"})
    let lf: PerformanceObserver | null = null
    try {
        lf = new PerformanceObserver((l) => l.getEntries().forEach((e) => loafs.push(e)))
        lf.observe({type: "long-animation-frame"})
    } catch {
        lf = null
    }
    const reqs =
        (window as unknown as {__switchRequests?: {start: number}[]}).__switchRequests ?? []
    const reqFrom = reqs.length
    const t0 = performance.now()
    link.click()
    let tUrl: number | null = null
    let tMarker: number | null = null
    let tPaint: number | null = null
    await new Promise<void>((resolve) => {
        const tick = () => {
            const now = performance.now()
            if (tUrl === null && location.pathname.includes(target)) tUrl = now
            if (tMarker === null && tUrl !== null && targetTurnText().includes(wanted)) {
                tMarker = now
                requestAnimationFrame(() =>
                    setTimeout(() => {
                        tPaint = performance.now()
                    }, 0),
                )
            }
            if (tPaint !== null) {
                const lastEnd = Math.max(tPaint, ...longtasks.map((e) => e.end))
                if (now - lastEnd >= QUIET) return resolve()
            }
            if (now - t0 > TIMEOUT) return resolve()
            setTimeout(tick, 16)
        }
        tick()
    })
    lt.disconnect()
    lf?.disconnect()
    const paint = tPaint as number | null
    const done =
        paint === null
            ? null
            : Math.max(paint, ...longtasks.filter((e) => e.start >= t0).map((e) => e.end))
    const r = (x: number | null) => (x === null ? null : Math.round(x - t0))
    let loafScript = 0
    let loafLayout = 0
    const top: {d: number; inv: string; fn: string; src: string; at: number}[] = []
    for (const f of loafs as (PerformanceEntry & {
        styleAndLayoutStart?: number
        scripts?: {
            duration: number
            invoker: string
            sourceFunctionName: string
            sourceURL: string
            startTime: number
        }[]
    })[]) {
        if (f.startTime < t0 || (done !== null && f.startTime > done)) continue
        if (f.styleAndLayoutStart) loafLayout += f.startTime + f.duration - f.styleAndLayoutStart
        for (const s of f.scripts ?? []) {
            loafScript += s.duration
            top.push({
                d: Math.round(s.duration),
                inv: s.invoker,
                fn: s.sourceFunctionName,
                src: (s.sourceURL || "").split("/").pop() ?? "",
                at: Math.round(s.startTime - t0),
            })
        }
    }
    top.sort((a, b) => b.d - a.d)
    const all = (
        reqs.slice(reqFrom) as {
            method: string
            url: string
            body: string
            start: number
            end: number | null
            status: number
        }[]
    ).filter((q) => done === null || q.start <= done + QUIET)
    const requests = all.map((q) => {
        const u = new URL(q.url, location.origin)
        return {
            method: q.method,
            path: u.pathname,
            project: u.searchParams.get("project_id") ?? "",
            query: [...u.searchParams.entries()]
                .filter(([k]) => k !== "project_id")
                .map(([k, v]) => `${k}=${v}`)
                .join("&"),
            body: q.body.length > 2000 ? q.body.slice(0, 2000) + "…" : q.body,
            at: Math.round(q.start - t0),
            d: q.end === null ? null : Math.round(q.end - q.start),
            status: q.status,
            beforeDone: done !== null && q.end !== null && q.end <= done,
        }
    })
    return {
        target,
        url_ms: r(tUrl),
        marker_ms: r(tMarker),
        paint_ms: r(paint),
        done_ms: r(done),
        timed_out: paint === null,
        longtasks: longtasks
            .filter((e) => e.start >= t0)
            .map((e) => ({at: r(e.start), d: Math.round(e.end - e.start)})),
        longtask_total: Math.round(
            longtasks.filter((e) => e.start >= t0).reduce((a, e) => a + e.end - e.start, 0),
        ),
        loaf: {
            script: Math.round(loafScript),
            style_layout_paint: Math.round(loafLayout),
            top: top.slice(0, 8),
        },
        requests,
    }
}

type ProbeResult = Exclude<Awaited<ReturnType<typeof probe>>, {error: string}>

/** Duplicates: the same method, path, query, project and body sent more than once in one switch. */
function duplicates(result: ProbeResult) {
    const groups = new Map<string, number>()
    for (const q of result.requests) {
        if (!q.path.includes("/api/") && !q.path.includes("/services/")) continue
        const k = [q.method, q.path, q.query, q.project, q.body].join(" ")
        groups.set(k, (groups.get(k) ?? 0) + 1)
    }
    return [...groups.entries()]
        .filter(([, n]) => n > 1)
        .map(([k, n]) => ({count: n, request: k.slice(0, 300)}))
}

async function measure(page: Page, target: Target): Promise<ProbeResult> {
    // The sidebar row must be on screen before the clock starts (the sidebar loads on its own).
    await page
        .locator(`a[href*="/sessions/${target.id}"]`)
        .filter({visible: true})
        .first()
        .waitFor({timeout: 60_000})
    const result = await page.evaluate(probe, target)
    if ("error" in result) throw new Error(result.error)
    if (result.timed_out)
        throw new Error(`the target turn never showed "${target.marker}" (${target.id})`)
    return result
}

function summarize(runs: ProbeResult[]) {
    const pick = (k: "done_ms" | "url_ms" | "marker_ms" | "longtask_total") =>
        runs
            .map((x) => x[k] as number | null)
            .filter((v): v is number => v !== null)
            .sort((a, b) => a - b)
    const stats = (v: number[]) => {
        if (!v.length) return null
        const med =
            v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
        return {median: med, min: v[0], max: v[v.length - 1], n: v.length}
    }
    const apiCounts = runs.map(
        (x) =>
            x.requests.filter((q) => q.path.includes("/api/") || q.path.includes("/services/"))
                .length,
    )
    return {
        done_ms: stats(pick("done_ms")),
        url_ms: stats(pick("url_ms")),
        marker_ms: stats(pick("marker_ms")),
        longtask_total: stats(pick("longtask_total")),
        api_requests: stats([...apiCounts].sort((a, b) => a - b)),
    }
}

async function signIn(page: Page) {
    page.setDefaultTimeout(60_000)
    await page.goto(`${requireEnv("APP_URL")}/m/auth`, {waitUntil: "load"})
    const email = page.locator("input[type=email], input[name=email]").first()
    await email.fill(requireEnv("QA_EMAIL"))
    const password = page.locator("input[type=password]").first()
    if ((await password.count()) === 0) await page.keyboard.press("Enter")
    await password.fill(requireEnv("QA_PASSWORD"))
    await page.keyboard.press("Enter")
    await page.waitForURL((url) => !url.pathname.startsWith("/m/auth"), {timeout: 60_000})
    await page.context().storageState({path: authFile})
}

/** Open a session by its URL: /m/w/<workspace>/p/<project>/sessions/<id>, read from the landing URL. */
async function openSession(page: Page, sessionId: string) {
    await page.goto(`${requireEnv("APP_URL")}/m`, {waitUntil: "load"})
    await page.waitForURL((u) => /\/m\/w\/[^/]+\/p\/[^/]+/.test(u.pathname))
    const prefix = new URL(page.url()).pathname.match(/\/m\/w\/[^/]+\/p\/[^/]+/)?.[0]
    const href = `${requireEnv("APP_URL")}${prefix}/sessions/${sessionId}`
    await page.goto(href, {waitUntil: "load"})
    return href
}

/**
 * Pin the three sessions in this browser (pins live in localStorage only, so no other user or
 * browser sees them). The sidebar shows a window of recent rows; on a shared stack new sessions
 * push older ones out of it, and a pinned row stays on screen.
 */
async function pinCases(page: Page, cases: Cases) {
    await page.evaluate(
        (ids) => {
            const project = location.pathname.match(/\/p\/([^/]+)/)?.[1]
            if (!project) return
            const all = JSON.parse(localStorage.getItem("agenta:sessions:pinned") ?? "{}")
            all[project] = ids
            localStorage.setItem("agenta:sessions:pinned", JSON.stringify(all))
        },
        [cases.origin.id, cases.sameAgent.id, cases.otherAgent.id],
    )
}

async function clickBack(page: Page, origin: Target) {
    await page.evaluate((id) => {
        const a = [
            ...document.querySelectorAll<HTMLAnchorElement>(`a[href*="/sessions/${id}"]`),
        ].find((x) => x.offsetParent !== null)
        a?.click()
    }, origin.id)
    await page.waitForURL((u) => u.pathname.includes(origin.id), {timeout: 20_000})
    await page.waitForTimeout(WARM_SETTLE_MS)
}

async function clearSessionCaches(page: Page) {
    await page.evaluate(async () => {
        for (const k of Object.keys(localStorage)) {
            if (
                k.startsWith("agenta:agent-chat:messages") ||
                k.startsWith("agenta:agent-chat:record-counts") ||
                /tabs/i.test(k)
            )
                localStorage.removeItem(k)
        }
        await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase("agenta-query-cache")
            req.onsuccess = req.onerror = req.onblocked = () => resolve()
        })
    })
}

test("session switch timing", async ({browser}) => {
    // A measurement on demand: a run of the visual config without SWITCH_CASES skips it.
    test.skip(!process.env.SWITCH_CASES, "SWITCH_CASES is not set")
    test.setTimeout(30 * 60_000)
    mkdirSync(requireEnv("OUT"), {recursive: true})
    const cases = JSON.parse(readFileSync(requireEnv("SWITCH_CASES"), "utf8")) as Cases

    {
        const context = await browser.newContext()
        const page = await context.newPage()
        try {
            await signIn(page)
        } catch (error) {
            await page.screenshot({path: `${out}/signin-failure.png`})
            throw error
        } finally {
            await page.close()
            await context.close()
        }
    }

    const context = await browser.newContext({
        viewport: {width: 1440, height: 900},
        storageState: authFile,
    })
    await context.addInitScript(recorderScript)
    const page = await context.newPage()
    page.setDefaultTimeout(60_000)
    if (CPU_THROTTLE > 1) {
        const cdp = await context.newCDPSession(page)
        await cdp.send("Emulation.setCPUThrottlingRate", {rate: CPU_THROTTLE})
    }
    const results: Record<string, ProbeResult[]> = {
        warm_same_agent: [],
        warm_other_agent: [],
        cold_same_agent: [],
    }
    try {
        const originHref = await openSession(page, cases.origin.id)
        await pinCases(page, cases)
        await page.goto(originHref, {waitUntil: "load"})
        if (PANEL) {
            const icon = page.locator(`#agent-panel-icon-${PANEL}`)
            if ((await icon.getAttribute("aria-pressed")) !== "true") await icon.click()
            await page.waitForTimeout(2_000)
        }
        await page.screenshot({path: `${out}/origin-panel-${PANEL || "closed"}.png`})
        await page.waitForTimeout(COLD_SETTLE_MS)

        // Warm: open the target once (not counted), then time origin -> target RUNS times.
        for (const [name, target] of [
            ["warm_same_agent", cases.sameAgent],
            ["warm_other_agent", cases.otherAgent],
        ] as const) {
            await measure(page, target)
            await clickBack(page, cases.origin)
            for (let i = 0; i < RUNS; i++) {
                results[name].push(await measure(page, target))
                await clickBack(page, cases.origin)
            }
        }

        // Cold: clear the session caches, reload the origin, settle 6 s, then time the switch.
        for (let i = 0; i < RUNS; i++) {
            await clearSessionCaches(page)
            await page.goto(originHref, {waitUntil: "load"})
            await page.waitForTimeout(COLD_SETTLE_MS)
            results.cold_same_agent.push(await measure(page, cases.sameAgent))
        }
    } finally {
        await page.close()
        await context.close()
        rmSync(authFile, {force: true})
    }

    const report = {
        meta: {
            date: new Date().toISOString(),
            app_url: requireEnv("APP_URL"),
            build: process.env.BUILD_LABEL ?? "",
            cpu_throttle: CPU_THROTTLE,
            panel: PANEL || "closed",
            runs: RUNS,
            browser: browser.version(),
            viewport: "1440x900",
        },
        summary: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, summarize(v)])),
        cases: Object.fromEntries(
            Object.entries(results).map(([k, v]) => [
                k,
                v.map((r, i) => ({run: i + 1, ...r, duplicates: duplicates(r)})),
            ]),
        ),
    }
    const file = `${out}/switch-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    writeFileSync(file, JSON.stringify(report, null, 2))
    console.log(`switch timing written to ${file}`)
    console.log(JSON.stringify(report.summary, null, 2))
})
