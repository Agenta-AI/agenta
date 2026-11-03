import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import type {Page} from "@playwright/test"

import {AGENT_APPS_UNAVAILABLE_REASON, archiveWorkflow, isAgentRevision} from "../utils/agentApps"

import {
    ELICITATION_PAYLOAD,
    elicitationPausedTurn,
    resumeTextTurn,
    sseFulfill,
    type ElicitationPayloadFixture,
} from "./assets/elicitationStream"
import {AgentChatFixtures} from "./assets/types"

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
    // seedAgentChatApp() runs before the test navigates anywhere, so page.url() is still
    // "about:blank" — a non-empty string that defeats `page.url() || fallback`, and whose
    // origin serializes to the literal string "null" (a bogus `/null/api/...` request).
    // Treat about:blank as "no real page yet" and fall back to the configured web URL,
    // same as the test config's own baseURL (playwright.config.ts).
    const currentUrl = page.url()
    const base =
        currentUrl && currentUrl !== "about:blank"
            ? currentUrl
            : process.env.AGENTA_WEB_URL || "http://localhost:3000"
    return `${new URL(base).origin}/api`
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

            const revisionBody = await post("/workflows/revisions/commit", {
                workflow_revision: {
                    workflow_id: workflowId,
                    workflow_variant_id: variantId,
                    slug: `${unique}rev`,
                    name: "default",
                    data: {uri: AGENT_URI, parameters: {agent: {}}, schemas: {}},
                    message: "Agent",
                },
            })
            const revisionId = requireId(revisionBody, "workflow_revision", "commit revision")

            // Environments without the agent platform (e.g. OSS previews with the feature
            // flags off) commit this same payload as a plain prompt revision, so the agent
            // playground under test can never render. Skip — and archive the seed first so
            // the misclassified app cannot pollute app lists used by other specs.
            if (!isAgentRevision(revisionBody?.workflow_revision)) {
                await archiveWorkflow(page, base, projectId, workflowId)
                baseTest.skip(true, AGENT_APPS_UNAVAILABLE_REASON)
            }

            seededRevisionByApp.set(workflowId, revisionId)
            return workflowId
        })
    },

    navigateToAgentPlayground: async ({page, uiHelpers}, use) => {
        await use(async (appId: string) => {
            const scopedPrefixFrom = (url: string) =>
                new URL(url || "http://localhost").pathname.match(/^(\/w\/[^/]+\/p\/[^/]+)/)?.[1] ??
                ""

            // seedAgentChatApp() only makes API calls, so on a fresh test page.url() is
            // still "about:blank" here — scopedPrefix would be permanently empty if read
            // now. Navigate to the unscoped /apps first (the server resolves it to the
            // workspace/project-scoped URL), THEN read the prefix from the page's new,
            // resolved URL. Reading it before this goto sent every later navigation
            // (playground included) to an unscoped path, which the app doesn't route to
            // the seeded app — it falls through to the bare onboarding playground instead.
            const initialScopedPrefix = scopedPrefixFrom(page.url())
            await page.goto(initialScopedPrefix ? `${initialScopedPrefix}/apps` : "/apps", {
                waitUntil: "domcontentloaded",
            })
            await uiHelpers.expectPath("/apps")

            const scopedPrefix = scopedPrefixFrom(page.url())
            const playgroundUrl = `${scopedPrefix}/apps/${appId}/playground`
            const revisionId = seededRevisionByApp.get(appId)
            const target = revisionId ? `${playgroundUrl}?revisions=${revisionId}` : playgroundUrl
            await page.goto(target, {waitUntil: "domcontentloaded"})
            await uiHelpers.expectPath(`/apps/${appId}/playground`)

            // The agent chat panel is interactive once the composer textbox is mounted.
            // (First-run: confirm this selector against the live RichChatInput composer.)
            const composer = page.getByRole("textbox").last()
            // A revision committed moments earlier via direct API calls can race the
            // playground's entity resolution (read-your-writes lag against the
            // just-created revision), landing on MainLayout's "Playground is unable to
            // communicate with the service" error state instead of the composer. That
            // panel's own "Try again" button has no onClick (dead), so recover with a
            // real reload instead, which re-runs entity resolution from scratch.
            const errorState = page.getByText(
                "Playground is unable to communicate with the service",
            )
            await expect(composer.or(errorState).first()).toBeVisible({timeout: 30000})
            for (let attempt = 0; attempt < 3 && !(await composer.isVisible()); attempt += 1) {
                await page.reload({waitUntil: "domcontentloaded"})
                await expect(composer.or(errorState).first()).toBeVisible({timeout: 20000})
            }
            await expect(composer).toBeVisible({timeout: 30000})
        })
    },

    mockElicitationInvoke: async ({page}, use) => {
        await use(async (payload: ElicitationPayloadFixture = ELICITATION_PAYLOAD) => {
            const calls: Record<string, any>[] = []
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
