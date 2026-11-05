// Paste into the page with the browser tool's JavaScript action, after the session has rendered.
// Set window.__verifyConfig = {agentId, sessionA, sessionB} first.
(() => {
    const {agentId, sessionA, sessionB} = window.__verifyConfig
    const projectId = location.pathname.match(/\/p\/([^/]+)/)[1]
    const base = location.pathname.replace(/\/sessions\/.*/, "").replace(/^\/m/, "")
    const realFetch = window.fetch.bind(window)
    const post = (path, body) =>
        realFetch(`http://localhost/api/${path}?project_id=${projectId}`, {
            method: "POST",
            credentials: "include",
            headers: {"content-type": "application/json"},
            body: JSON.stringify(body),
        }).then((response) => response.json())
    const commitRevision = (revision, message) =>
        post("workflows/revisions/commit", {
            workflow_revision: {
                workflow_id: revision.workflow_id,
                workflow_variant_id: revision.workflow_variant_id,
                slug: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
                name: revision.name,
                data: revision.data,
                flags: revision.flags,
                message,
            },
        }).then((result) => result.workflow_revision?.version)
    const latest = () =>
        post("workflows/revisions/retrieve", {workflow_ref: {id: agentId}}).then(
            (result) => result.workflow_revision,
        )

    const style = document.createElement("style")
    style.textContent = "nextjs-portal{display:none!important}"
    document.head.appendChild(style)

    let original = null
    let runningRow = null
    window.fetch = async (input, init) => {
        const response = await realFetch(input, init)
        const url = typeof input === "string" ? input : input.url
        const liveness =
            /sessions\/streams\/query/.test(url) && /is_alive/.test(String(init?.body ?? ""))
        if (!runningRow || !liveness) return response
        const body = await response.clone().json()
        const streams = (body.streams ?? []).filter((row) => row.session_id !== sessionA)
        streams.push(runningRow)
        return new Response(JSON.stringify({...body, count: streams.length, streams}), {
            status: 200,
            headers: {"content-type": "application/json"},
        })
    }

    window.__v = {
        sessionA,
        sessionB,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        go: (sessionId) => window.next.router.push(`${base}/sessions/${sessionId}`),
        words: () =>
            document.body.innerText.match(/AGENTS\.md\s*\n?\s*([\d,]+) words/)?.[1] ?? null,
        pill: () =>
            [...document.querySelectorAll("button")].find((b) => /available/.test(b.textContent))
                ?.textContent ?? null,
        stopVisible: () =>
            [...document.querySelectorAll("button")].some((b) =>
                /stop/i.test(b.getAttribute("aria-label") ?? b.textContent),
            ),
        recheck: () =>
            document.dispatchEvent(new Event("visibilitychange", {bubbles: true})),
        commitElsewhere: async (message, words = 20) => {
            const revision = await latest()
            original ??= structuredClone(revision)
            revision.data.parameters.agent.instructions.agents_md +=
                `\n${Array(words).fill("regression").join(" ")} ${Date.now()}`
            return commitRevision(revision, message)
        },
        restore: () =>
            original ? commitRevision(original, "Restore the config after verification") : null,
        simulateRunning: async (on) => {
            if (!on) {
                runningRow = null
                return
            }
            const body = await post("sessions/streams/query", {
                session_ids: [sessionA],
                windowing: {limit: 5},
            })
            const row = body.streams.find((stream) => stream.session_id === sessionA)
            runningRow = {
                ...row,
                turn_id: row.turn_id ?? "verification-turn",
                flags: {...row.flags, is_alive: true, is_running: true},
            }
        },
    }
})()
