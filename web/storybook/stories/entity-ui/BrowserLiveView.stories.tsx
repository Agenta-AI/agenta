import {useRef} from "react"

import {
    BrowserLiveSurface,
    type BrowserLiveConnection,
    type BrowserLiveStatus,
} from "@agenta/entity-ui/browser"
import type {Meta, StoryObj} from "@storybook/nextjs"

/** The live view's surface without a socket, so each connection state renders on its own. */
const Surface = ({
    connection,
    status = null,
}: {
    connection: BrowserLiveConnection
    status?: BrowserLiveStatus | null
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    return (
        <div className="flex h-[560px] max-w-4xl flex-col">
            <BrowserLiveSurface
                connection={connection}
                status={status}
                canvasRef={canvasRef}
                send={() => undefined}
                onReconnect={() => undefined}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/entity-ui/Browser/BrowserLiveView",
    component: Surface,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The cloud browser live view: URL bar, Take control toggle, and the canvas. These stories render the surface in each connection state without a WebSocket.",
            },
        },
    },
} satisfies Meta<typeof Surface>

export default meta
type Story = StoryObj<typeof meta>

export const Connecting: Story = {args: {connection: {phase: "connecting"}}}

export const Closed: Story = {
    args: {connection: {phase: "closed", reason: "No browser is running right now."}},
}

export const ErrorState: Story = {
    args: {
        connection: {
            phase: "error",
            reason: "Your sign-in expired. Sign in again to see the browser.",
        },
    },
}

export const AgentInControl: Story = {
    args: {
        connection: {phase: "live"},
        status: {control: "agent", url: "https://github.com/login", title: "Sign in to GitHub"},
    },
}
