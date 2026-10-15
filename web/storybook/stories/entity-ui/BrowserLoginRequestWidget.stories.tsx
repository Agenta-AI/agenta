import type {ClientToolMeta} from "@agenta/shared/clientTools"
import type {Meta, StoryObj} from "@storybook/nextjs"
import type {ToolUIPart} from "ai"

// Imported from source: the widget is reached through the client-tool registry, not a barrel.
import {BrowserLoginRequestWidget} from "../../../packages/agenta-entity-ui/src/clientTools/BrowserLoginRequestWidget"

const meta_ = (overrides: Partial<ClientToolMeta> = {}): ClientToolMeta => ({
    toolCallId: "call-1",
    toolName: "browser_request_login",
    renderKind: "browser_login",
    state: "input-available",
    input: {site: "x.com", message: "I need your X login to read your timeline."},
    output: undefined,
    settled: false,
    part: {} as ToolUIPart,
    ...overrides,
})

const settle = () => undefined

const meta = {
    title: "@agenta/entity-ui/ClientTools/BrowserLoginRequestWidget",
    component: BrowserLoginRequestWidget,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The dock card for `browser_request_login`. Add and sign in creates a login for the site and opens its live browser. With no project selected, Add shows the API error in the card.",
            },
        },
    },
    decorators: [
        (Story) => (
            <div className="w-[480px]">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof BrowserLoginRequestWidget>

export default meta
type Story = StoryObj<typeof meta>

export const Pending: Story = {args: {meta: meta_(), settle}}

export const NoMessage: Story = {args: {meta: meta_({input: {site: "x.com"}}), settle}}

export const TimelineRow: Story = {args: {meta: meta_(), settle, bare: true}}

export const Added: Story = {
    args: {
        meta: meta_({
            settled: true,
            state: "output-available",
            output: {added: true, site: "x.com"},
        }),
        settle,
    },
}

export const NotAdded: Story = {
    args: {meta: meta_({settled: true, state: "output-error"}), settle},
}
