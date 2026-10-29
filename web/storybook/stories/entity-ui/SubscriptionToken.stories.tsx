import {useEffect} from "react"

import type {ProviderConnection, SecretKind} from "@agenta/entities/secret"
import {SubscriptionSignInDialog, SubscriptionTokenCard} from "@agenta/entity-ui/secretProvider"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {userEvent, within} from "storybook/test"

import type {AgentaDataParameters} from "../../.storybook/decorators/withAgentaData"

// The Claude subscription connect flow: a pasted `claude setup-token` value, checked by the API.
// The token route is answered by a stubbed fetch, so every state is reachable without a backend.

type TokenAnswer = "pending" | "rejected" | "unverified"

const ANSWERS: Record<Exclude<TokenAnswer, "pending">, {status: number; detail: object}> = {
    rejected: {
        status: 422,
        detail: {
            code: "subscription_token_rejected",
            message: "Claude did not accept this token.",
            retryable: false,
            next_step: "Run `claude setup-token` again and paste the new token.",
        },
    },
    unverified: {
        status: 502,
        detail: {
            code: "subscription_token_unverified",
            message: "Agenta could not check this token with Claude.",
            retryable: true,
            next_step: "Try again in a moment.",
        },
    },
}

/** Answer the token route as `answer` says; every other request goes to the real fetch. */
const useTokenRoute = (answer: TokenAnswer) => {
    useEffect(() => {
        const realFetch = window.fetch
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input)
            if (!url.includes("subscription-token")) return realFetch(input, init)
            if (answer === "pending") return new Promise<Response>(() => undefined)
            const {status, detail} = ANSWERS[answer]
            return Promise.resolve(
                new Response(JSON.stringify({detail}), {
                    status,
                    headers: {"Content-Type": "application/json"},
                }),
            )
        }) as typeof window.fetch
        return () => {
            window.fetch = realFetch
        }
    }, [answer])
}

const claude = (loginState: string): ProviderConnection => ({
    id: "story-claude",
    slug: "claude",
    name: "Claude",
    kind: "anthropic",
    title: "Claude",
    secretKind: "subscription_provider" as SecretKind,
    models: ["default", "sonnet", "haiku"],
    harnesses: ["claude"],
    hasStoredCredential: loginState === "ready",
    subscription: {provider: "claude", loginState},
    source: {name: "Claude", provider: "claude"} as ProviderConnection["source"],
})

interface StageProps {
    surface: "dialog" | "card"
    connected: boolean
    answer: TokenAnswer
}

const Stage = ({surface, connected, answer}: StageProps) => {
    useTokenRoute(answer)
    const connection = claude(connected ? "ready" : "pending_login")
    return surface === "dialog" ? (
        <SubscriptionSignInDialog
            open
            onClose={() => undefined}
            provider="claude"
            connection={connection}
            onRemove={() => undefined}
        />
    ) : (
        <div data-vrt-subject className="w-[432px]">
            <SubscriptionTokenCard connection={connection} />
        </div>
    )
}

const meta = {
    title: "@agenta/entity-ui/SecretProvider/SubscriptionToken",
    component: Stage,
    parameters: {layout: "centered", agenta: {} satisfies AgentaDataParameters},
    args: {surface: "dialog", connected: false, answer: "pending"},
    argTypes: {
        surface: {control: "inline-radio", options: ["dialog", "card"]},
        answer: {control: "inline-radio", options: ["pending", "rejected", "unverified"]},
    },
} satisfies Meta<typeof Stage>

export default meta
type Story = StoryObj<typeof meta>

const TOKEN = "sk-ant-oat01-story-token"

/** Type a token into the paste field and press Connect, opening the card's steps first. */
const submitToken = async (canvasElement: HTMLElement, surface: StageProps["surface"]) => {
    const screen = within(canvasElement.ownerDocument.body)
    if (surface === "card") await userEvent.click(await screen.findByText("Connect Claude"))
    await userEvent.type(await screen.findByPlaceholderText("sk-ant-oat01-…"), TOKEN)
    await userEvent.click(await screen.findByRole("button", {name: "Connect"}))
}

const openReplace = async (canvasElement: HTMLElement) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(await screen.findByRole("button", {name: "Replace token"}))
}

export const DialogEmpty: Story = {}

export const DialogChecking: Story = {
    play: ({canvasElement}) => submitToken(canvasElement, "dialog"),
}

export const DialogRefused: Story = {
    args: {answer: "rejected"},
    play: ({canvasElement}) => submitToken(canvasElement, "dialog"),
}

export const DialogUnverified: Story = {
    args: {answer: "unverified"},
    play: ({canvasElement}) => submitToken(canvasElement, "dialog"),
}

export const DialogConnected: Story = {args: {connected: true}}

export const DialogReplace: Story = {
    args: {connected: true},
    play: ({canvasElement}) => openReplace(canvasElement),
}

export const CardEmpty: Story = {args: {surface: "card"}}

export const CardChecking: Story = {
    args: {surface: "card"},
    play: ({canvasElement}) => submitToken(canvasElement, "card"),
}

export const CardRefused: Story = {
    args: {surface: "card", answer: "rejected"},
    play: ({canvasElement}) => submitToken(canvasElement, "card"),
}

export const CardUnverified: Story = {
    args: {surface: "card", answer: "unverified"},
    play: ({canvasElement}) => submitToken(canvasElement, "card"),
}

export const CardConnected: Story = {args: {surface: "card", connected: true}}

export const CardReplace: Story = {
    args: {surface: "card", connected: true},
    play: ({canvasElement}) => openReplace(canvasElement),
}
