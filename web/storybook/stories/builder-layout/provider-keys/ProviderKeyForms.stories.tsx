import {useEffect} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {providerConnectionView, providerListView} from "@agenta/entity-ui/secretProvider"
import {userAtom} from "@agenta/shared/state"
import {useViewStack, ViewStackHost, type ViewTarget} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {userEvent, within} from "storybook/test"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    MODEL_PICKER_USER_ID,
    modelProvidersQueries,
} from "../../../fixtures/builderLayout/model-picker"
import {
    OPENAI_CONNECTION_ID,
    PROBE_ANSWERS,
    PROVIDER_KEYS_USER_ID,
    providerKeysQueries,
} from "../../../fixtures/builderLayout/provider-keys"

const panelOf = (phone: boolean): AgentPanelApi => ({
    content: "configuration",
    toggle: async () => true,
    close: async () => true,
    configTab: "agent",
    setConfigTab: () => undefined,
    wide: false,
    setWide: () => undefined,
    phone,
    available: {files: true, configuration: true, builder: false},
})

const PROJECT: ViewTarget = {kind: "project"}

interface FrameProps {
    /** The provider form of this kind; absent opens the Model providers list. */
    kind?: string
    connectionId?: string
    /** The phone screen (M12): 390 x 844, the phone chrome, 44 px hit areas. */
    phone?: boolean
}

/** Opens the provider form (or the list) at depth 1, as a click would. */
const Open = ({kind, connectionId}: FrameProps) => {
    const stack = useViewStack()
    useEffect(() => {
        if (kind) {
            void stack.open(
                providerConnectionView,
                {kind, ...(connectionId ? {connectionId} : {})},
                PROJECT,
            )
        } else {
            void stack.open(providerListView, {}, PROJECT)
        }
        // Open once on mount, like a click.
    }, [])
    return null
}

const PanelFrame = ({kind, connectionId, phone = false}: FrameProps) => (
    <AgentPanelContext.Provider value={panelOf(phone)}>
        <div
            data-testid="agent-panel"
            className={`ag-panel-raised flex flex-col border border-solid border-border ${phone ? "h-[844px]" : "h-[760px]"}`}
            style={{width: phone ? 390 : 440}}
        >
            <ViewStackHost
                chrome={PanelViewChrome}
                rootTitle={phone ? "Model" : "Model providers"}
                phone={phone}
            >
                <Open kind={kind} connectionId={connectionId} />
            </ViewStackHost>
        </div>
    </AgentPanelContext.Provider>
)

/**
 * Answers `POST /providers/probe` with a fixed answer, or never ("pending"), so a frame shows
 * one state of the key check. Every other request goes out as usual.
 */
const answerProbe = (answer: unknown) => () => {
    const original = window.fetch
    window.fetch = (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (!url.includes("/providers/probe")) return original(input, init)
        if (answer === "pending") return new Promise<Response>(() => undefined)
        // Stamped when it answers, so "List updated just now" holds whenever the story runs.
        const body = {...(answer as Record<string, unknown>), fetched_at: new Date().toISOString()}
        return Promise.resolve(
            new Response(JSON.stringify(body), {
                status: 200,
                headers: {"content-type": "application/json"},
            }),
        )
    }
    return () => {
        window.fetch = original
    }
}

/** Pastes a key into the key field, which starts the check. */
const pasteKey = async (canvasElement: HTMLElement, placeholder: string) => {
    const canvas = within(canvasElement)
    const field = await canvas.findByPlaceholderText(placeholder)
    await userEvent.click(field)
    await userEvent.paste("sk-proj-story-key-0000")
}

const meta = {
    title: "BuilderLayout/provider-keys/Provider key forms",
    component: PanelFrame,
    parameters: {
        layout: "padded",
        agenta: {
            atoms: [[userAtom, {id: PROVIDER_KEYS_USER_ID, email: "bob@acme.com"}]] as [
                typeof userAtom,
                unknown,
            ][],
            queries: (scope: StoryScope) => providerKeysQueries(scope),
        },
    },
} satisfies Meta<typeof PanelFrame>

export default meta
type Story = StoryObj<typeof meta>

/** F09 f4: a new OpenAI form, "OpenAI 2", one sentence about the check, Save disabled. */
export const OpenAiNew: Story = {args: {kind: "openai"}}

/** F09 f5: the key was pasted; the check runs under the field, with Stop. */
export const OpenAiChecking: Story = {
    args: {kind: "openai"},
    beforeEach: answerProbe("pending"),
    play: ({canvasElement}) => pasteKey(canvasElement, "Paste your OpenAI API key"),
}

/** F09 f6: the key works; the models are here with the recommended ones checked. */
export const OpenAiKeyWorks: Story = {
    args: {kind: "openai"},
    beforeEach: answerProbe(PROBE_ANSWERS.works),
    play: ({canvasElement}) => pasteKey(canvasElement, "Paste your OpenAI API key"),
}

/** F09 f7: OpenAI did not accept the key; Check again, nothing below. */
export const OpenAiKeyRejected: Story = {
    args: {kind: "openai"},
    beforeEach: answerProbe(PROBE_ANSWERS.rejected),
    play: ({canvasElement}) => pasteKey(canvasElement, "Paste your OpenAI API key"),
}

/** F11 f1: the key works and "Harnesses" is open. */
export const HarnessesOpen: Story = {
    args: {kind: "openai"},
    beforeEach: answerProbe(PROBE_ANSWERS.works),
    play: async ({canvasElement}) => {
        await pasteKey(canvasElement, "Paste your OpenAI API key")
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("button", {name: /Harnesses/}))
    },
}

/** F11 f2: an existing connection; the saved choice at once, the list updated in the background. */
export const EditConnection: Story = {
    args: {kind: "openai", connectionId: OPENAI_CONNECTION_ID},
    beforeEach: answerProbe(PROBE_ANSWERS.works),
}

/** F11 f3: Azure OpenAI, three required fields and the dashed box. */
export const Azure: Story = {args: {kind: "azure"}}

/** F11 f4: AWS Bedrock signing in with one API key. */
export const BedrockApiKey: Story = {args: {kind: "bedrock"}}

/** F11 f5: AWS Bedrock signing in with access keys. */
export const BedrockAccessKeys: Story = {
    args: {kind: "bedrock"},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole("radio", {name: /Access keys/}))
    },
}

/** F11 f6: Google Vertex AI, with the 10-row credentials box. */
export const Vertex: Story = {args: {kind: "vertex_ai"}}

/** F11 f7: an OpenAI-compatible endpoint, with its protocol. */
export const OpenAiCompatible: Story = {args: {kind: "custom"}}

/** M12: Model providers on a phone, the list with the full-width primary action at the bottom. */
export const PhoneList: Story = {
    args: {phone: true},
    parameters: {
        viewport: {defaultViewport: "mobile2"},
        agenta: {
            atoms: [[userAtom, {id: MODEL_PICKER_USER_ID, email: "bob@acme.com"}]] as [
                typeof userAtom,
                unknown,
            ][],
            queries: (scope: StoryScope) => modelProvidersQueries(scope),
        },
    },
}

/** M12: the OpenAI form full screen on a phone, after the key works. */
export const PhoneForm: Story = {
    args: {kind: "openai", phone: true},
    beforeEach: answerProbe(PROBE_ANSWERS.works),
    play: ({canvasElement}) => pasteKey(canvasElement, "Paste your OpenAI API key"),
}
