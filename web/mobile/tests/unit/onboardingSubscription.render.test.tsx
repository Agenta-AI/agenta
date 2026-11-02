// @vitest-environment jsdom
// The Credits step's subscription rows: a newly connected subscription moves the first agent onto
// its own connection, by id, even when credits, the other subscription and a mounted login exist.
import {act} from "react"

import type {AgentModelCandidate, ProviderConnection, SecretKind} from "@agenta/entities/secret"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {success} = vi.hoisted(() => ({success: vi.fn()}))
vi.mock("@agenta/ui/app-message", () => ({message: {success}}))

import {ONBOARDING_COPY} from "@/features/onboarding/onboardingCopy"
import {
    useOnboardingSubscription,
    type OnboardingSubscription,
    type PendingSwitch,
} from "@/features/onboarding/useOnboardingSubscription"

const candidate = (
    connectionKey: string,
    harness: string,
    source: AgentModelCandidate["source"],
): AgentModelCandidate => ({
    modelId: `${connectionKey}-model`,
    provider: harness === "claude" ? "anthropic" : "openai-codex",
    mode: source === "subscription" ? "self_managed" : "agenta",
    slug: connectionKey,
    harness,
    source,
    connectionKey,
    managed: connectionKey === "starter-credits",
})

const CREDITS = candidate("starter-credits", "pi_core", "connection")
// A login the deployment mounts: same harness as the Claude subscription, but no record.
const MOUNTED_CLAUDE = candidate("subscription:anthropic", "claude", "subscription")
const CHATGPT = candidate("chatgpt-1", "pi_core", "subscription")
const CLAUDE = candidate("claude-1", "claude", "subscription")
const CANDIDATES = [CREDITS, MOUNTED_CLAUDE, CHATGPT, CLAUDE]

const connection = (id: string, provider: string, loginState: string): ProviderConnection => ({
    id,
    slug: id,
    name: provider,
    kind: provider === "claude" ? "anthropic" : "openai",
    title: provider,
    secretKind: "subscription_provider" as SecretKind,
    hasStoredCredential: loginState === "ready",
    subscription: {provider, loginState},
    source: {name: provider, provider} as ProviderConnection["source"],
})

interface Inputs {
    chatgpt: ProviderConnection | null
    claude: ProviderConnection | null
    selected: AgentModelCandidate | undefined
}

const picks: (AgentModelCandidate | undefined)[] = []
const arm = (pending: PendingSwitch) => picks.push(pending(CANDIDATES))
const rows: {chatgpt?: OnboardingSubscription; claude?: OnboardingSubscription} = {}

const Harness = ({chatgpt, claude, selected}: Inputs) => {
    const shared = {available: true, status: "ready" as const, selected, arm}
    rows.chatgpt = useOnboardingSubscription({
        ...shared,
        connection: chatgpt,
        connectedMessage: ONBOARDING_COPY.model.chatgptConnected,
    })
    rows.claude = useOnboardingSubscription({
        ...shared,
        connection: claude,
        connectedMessage: ONBOARDING_COPY.model.claudeConnected,
    })
    return null
}

let root: Root | undefined
let host: HTMLDivElement | undefined

const render = (inputs: Inputs) =>
    act(() => {
        root!.render(<Harness {...inputs} />)
    })

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    picks.length = 0
    success.mockReset()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root!.unmount())
    host?.remove()
    vi.unstubAllGlobals()
})

describe("the Credits step's subscription rows", () => {
    it("switches to each subscription as it connects, and marks only the last one in use", () => {
        render({
            chatgpt: connection("chatgpt-1", "chatgpt", "pending_login"),
            claude: null,
            selected: CREDITS,
        })
        expect(picks).toEqual([])
        expect(rows.chatgpt?.inUse).toBe(false)
        expect(rows.claude?.inUse).toBe(false)

        render({
            chatgpt: connection("chatgpt-1", "chatgpt", "ready"),
            claude: null,
            selected: CREDITS,
        })
        expect(picks).toEqual([CHATGPT])

        render({
            chatgpt: connection("chatgpt-1", "chatgpt", "ready"),
            claude: connection("claude-1", "claude", "ready"),
            selected: CHATGPT,
        })
        // The Claude connection's own model, not the mounted login on the same harness.
        expect(picks).toEqual([CHATGPT, CLAUDE])

        render({
            chatgpt: connection("chatgpt-1", "chatgpt", "ready"),
            claude: connection("claude-1", "claude", "ready"),
            selected: CLAUDE,
        })
        expect(rows.claude?.inUse).toBe(true)
        expect(rows.chatgpt?.inUse).toBe(false)
    })

    it("marks no subscription row in use while a mounted login runs the agent", () => {
        render({
            chatgpt: connection("chatgpt-1", "chatgpt", "ready"),
            claude: connection("claude-1", "claude", "ready"),
            selected: MOUNTED_CLAUDE,
        })
        expect(picks).toEqual([])
        expect(rows.chatgpt?.inUse).toBe(false)
        expect(rows.claude?.inUse).toBe(false)
    })

    it("closes the Claude dialog with a toast once the token is stored", () => {
        render({
            chatgpt: null,
            claude: connection("claude-1", "claude", "pending_login"),
            selected: CREDITS,
        })
        act(() => rows.claude!.setDialogOpen(true))
        expect(rows.claude?.dialogOpen).toBe(true)

        render({
            chatgpt: null,
            claude: connection("claude-1", "claude", "ready"),
            selected: CREDITS,
        })

        expect(rows.claude?.dialogOpen).toBe(false)
        expect(success).toHaveBeenCalledWith("Claude connected. Your agent will run on it.")
        expect(picks).toEqual([CLAUDE])
    })
})
