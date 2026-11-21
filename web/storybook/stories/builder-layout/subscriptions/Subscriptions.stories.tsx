import {useEffect} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {SubscriptionSignInCard, subscriptionTokenView} from "@agenta/entity-ui/secretProvider"
import {userAtom} from "@agenta/shared/state"
import {
    defineView,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewTarget,
} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    MODEL_PICKER_USER_ID,
    modelProvidersQueries,
} from "../../../fixtures/builderLayout/model-picker"
import {CHATGPT_ATTEMPT, SIGN_IN_NOW} from "../../../fixtures/builderLayout/subscriptions"

const panel: AgentPanelApi = {
    content: "configuration",
    toggle: async () => true,
    close: async () => true,
    configTab: "agent",
    setConfigTab: () => undefined,
    wide: false,
    setWide: () => undefined,
    phone: false,
    available: {files: true, configuration: true, builder: false},
}

const PROJECT: ViewTarget = {kind: "project"}

/**
 * The ChatGPT frames draw the view's card from a recorded attempt: the real view starts a
 * sign-in on the server when it opens.
 */
const chatgptFrame = (copied: boolean) =>
    defineView<Record<string, never>>({
        id: "story.subscriptionSignIn",
        apply: "immediate",
        Component: () => {
            useViewTitle("ChatGPT")
            return (
                <SubscriptionSignInCard
                    name="ChatGPT"
                    phase="waiting"
                    attempt={CHATGPT_ATTEMPT}
                    now={SIGN_IN_NOW}
                    copied={copied}
                    onCopy={() => undefined}
                    onCancel={() => undefined}
                    onConnect={() => undefined}
                />
            )
        },
    })

type Frame = "chatgpt" | "chatgptCopied" | "claude"

const CHATGPT = chatgptFrame(false)
const CHATGPT_COPIED = chatgptFrame(true)

/** Opens the frame's view at depth 1, so the crumb skips "Model providers". */
const Open = ({frame}: {frame: Frame}) => {
    const stack = useViewStack()
    useEffect(() => {
        if (frame === "claude")
            void stack.open(subscriptionTokenView, {provider: "claude"}, PROJECT)
        else void stack.open(frame === "chatgpt" ? CHATGPT : CHATGPT_COPIED, {}, PROJECT)
        // Open once on mount, like a click.
    }, [])
    return null
}

const PanelFrame = ({frame}: {frame: Frame}) => (
    <AgentPanelContext.Provider value={panel}>
        <div
            data-testid="agent-panel"
            className="ag-panel-raised flex h-[720px] flex-col border border-solid border-border"
            style={{width: 440}}
        >
            <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                <Open frame={frame} />
            </ViewStackHost>
        </div>
    </AgentPanelContext.Provider>
)

const meta = {
    title: "BuilderLayout/subscriptions/Subscriptions",
    component: PanelFrame,
    parameters: {
        layout: "padded",
        agenta: {
            atoms: [[userAtom, {id: MODEL_PICKER_USER_ID, email: "bob@acme.com"}]] as [
                typeof userAtom,
                unknown,
            ][],
            queries: (scope: StoryScope) => modelProvidersQueries(scope),
        },
    },
} satisfies Meta<typeof PanelFrame>

export default meta
type Story = StoryObj<typeof meta>

/** F11 f8: ChatGPT, signing in. The code, "Copy", "Open ChatGPT" and the countdown. */
export const ChatgptSigningIn: Story = {args: {frame: "chatgpt"}}

/** F11 f9: after "Copy". "Copied" and the waiting block. */
export const ChatgptAfterCopy: Story = {args: {frame: "chatgptCopied"}}

/** F11 f10: Claude, the token. Three steps; "Connect" is on only for a setup token. */
export const ClaudeToken: Story = {args: {frame: "claude"}}
