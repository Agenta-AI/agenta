import type {Page} from "@playwright/test"

import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"

import {AgentChatFixtures} from "./assets/types"
import {
    ELICITATION_PAYLOAD,
    elicitationPausedTurn,
    resumeTextTurn,
    sseFulfill,
    type ElicitationPayloadFixture,
} from "./assets/elicitationStream"

/**
 * Agent-chat acceptance fixtures (elicitation / interaction-kinds M1, layer A).
 *
 * Strategy: keep auth, project, the seeded agent revision, and the playground shell REAL, and mock
 * only the agent run (`**​/invoke*`) with deterministic SSE. That isolates the FE contract — emit →
 * render → settle → resume → replay — with no LLM in the loop.
 */

/** The built-in agent URI — the backend derives `is_agent` from `data.uri` key "agent". */
const AGENT_URI = "agenta:builtin:agent:v0"

/** Revision id per seeded app, so navigation can deep-link `?revisions=`. */
const seededRevisionByApp = new Map<string, string>()

const apiBase = (page: Page): string => {
    if (process.env.AGENTA_API_URL) return process.env.AGENTA_API_URL
    const origin = new URL(page.url() || process.env.AGENTA_WEB_URL || "http://localhost:3000")
        .origin
    return `${origin}/api`
}

const testWithAgentChatFixtures = baseTest.extend<AgentChatFixtures>({
    // Seed a minimal is_agent app via the API (Artifact → Variant → Revision). `is_agent` falls out
    // of the revision's `data.uri` — no provider/model needed (the run is mocked). Auth rides the
    // browser context's session cookies (storageState), same as apiHelpers' direct calls.
    seedAgentChatApp: async ({page, apiHelpers}, use) => {
        await use(async () => {
            const base = apiBase(page)
            const projectId = apiHelpers.getProjectScopedBasePath().match(/\/p\/([^/]+)/)?.[1]
            if (!projectId) throw new Error("[agent-chat E2E] could not derive projectId")
            const q = `?project_id=${projectId}`
            const unique = `${Date.now()}`
            const slug = `e2e-agent-${unique}`

            const post = async (path: string, data: Record<string, unknown>) => {
                const res = await page.request.post(`${base}${path}${q}`, {data})
                if (!res.ok()) {
                    throw new Error(
                        `[agent-chat E2E] POST ${path} -> ${res.status()} ${await res
                            .text()
                            .catch(() => "")}`,
                    )
                }
                return res.json()
            }
            // Fail fast at the exact step whose response is missing its id, rather than seeding a
            // broken app that only surfaces as a confusing timeout downstream.
            const requireId = (body: any, key: string, step: string): string => {
                const id = body?.[key]?.id
                if (typeof id !== "string" || !id) {
                    throw new Error(
                        `[agent-chat E2E] ${step} returned no id (body: ${JSON.stringify(body).slice(0, 200)})`,
                    )
                }
                return id
            }

            const workflowId = requireId(
                await post("/workflows/", {
                    workflow: {
                        slug,
                        name: "E2E Agent",
                        flags: {is_application: true, is_evaluator: false, is_snippet: false},
                    },
                }),
                "workflow",
                "create workflow",
            )

            const variantId = requireId(
                await post("/workflows/variants/", {
                    workflow_variant: {
                        workflow_id: workflowId,
                        slug: `${slug}.default`,
                        name: "default",
                    },
                }),
                "workflow_variant",
                "create variant",
            )

            const revisionId = requireId(
                await post("/workflows/revisions/commit", {
                    workflow_revision: {
                        workflow_id: workflowId,
                        workflow_variant_id: variantId,
                        slug: `${unique}rev`,
                        name: "default",
                        data: {uri: AGENT_URI, parameters: {agent: {}}, schemas: {}},
                        message: "Agent",
                    },
                }),
                "workflow_revision",
                "commit revision",
            )

            seededRevisionByApp.set(workflowId, revisionId)
            return workflowId
        })
    },

    navigateToAgentPlayground: async ({page, uiHelpers}, use) => {
        await use(async (appId: string) => {
            const scopedPrefix =
                new URL(page.url() || "http://localhost").pathname.match(
                    /^(\/w\/[^/]+\/p\/[^/]+)/,
                )?.[1] ?? ""
            const playgroundUrl = `${scopedPrefix}/apps/${appId}/playground`
            const revisionId = seededRevisionByApp.get(appId)

            await page.goto(scopedPrefix ? `${scopedPrefix}/apps` : "/apps", {
                waitUntil: "domcontentloaded",
            })
            await uiHelpers.expectPath("/apps")
            const target = revisionId ? `${playgroundUrl}?revisions=${revisionId}` : playgroundUrl
            await page.goto(target, {waitUntil: "domcontentloaded"})
            await uiHelpers.expectPath(`/apps/${appId}/playground`)

            // The agent chat panel is interactive once the composer textbox is mounted.
            // (First-run: confirm this selector against the live RichChatInput composer.)
            await expect(page.getByRole("textbox").last()).toBeVisible({timeout: 30000})
        })
    },

    mockElicitationInvoke: async ({page}, use) => {
        await use(async (payload: ElicitationPayloadFixture = ELICITATION_PAYLOAD) => {
            const calls: Array<Record<string, any>> = []
            let resumeText = "Thanks — I've recorded your answers."
            let n = 0
            const toolCallId = "call_elicit_1"

            await page.route("**/invoke*", async (route) => {
                const post = route.request().postData()
                try {
                    calls.push(post ? JSON.parse(post) : {})
                } catch {
                    calls.push({raw: post})
                }
                n += 1
                const body =
                    n === 1
                        ? elicitationPausedTurn({
                              messageId: `msg-${n}`,
                              toolCallId,
                              payload,
                              preamble: "One moment — I need a couple of details.",
                          })
                        : resumeTextTurn({messageId: `msg-${n}`, text: resumeText})
                await route.fulfill(sseFulfill(body))
            })

            return {
                calls,
                setResumeText: (text: string) => {
                    resumeText = text
                },
            }
        })
    },

    sendChatMessage: async ({page}, use) => {
        await use(async (text: string) => {
            const composer = page.getByRole("textbox").last()
            await composer.click()
            await composer.fill(text)
            // First-run: confirm send is Enter (RichChatInput) vs a Send button.
            await composer.press("Enter")
        })
    },
})

export {testWithAgentChatFixtures as test}
export {expect}
