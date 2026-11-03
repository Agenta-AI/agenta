import {useRef} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

import {BrowserLiveSurface} from "../../../packages/agenta-entity-ui/src/browser/BrowserLiveSurface"
import {
    closedBy,
    type BrowserLiveConnection,
    type BrowserLiveStatus,
} from "../../../packages/agenta-entity-ui/src/browser/useBrowserLiveSocket"

/**
 * The live view of the agent's browser, in each state the socket can put it in. The canvas is
 * blank here: frames only come from a running browser.
 */
const LiveSurface = ({
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
                viewport={{width: 1280, height: 800}}
                canvasRef={canvasRef}
                send={() => {}}
                onReconnect={() => {}}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/entity-ui/Browser/BrowserLiveSurface",
    component: LiveSurface,
    parameters: {layout: "padded"},
} satisfies Meta<typeof LiveSurface>

export default meta
type Story = StoryObj<typeof LiveSurface>

const page: BrowserLiveStatus = {
    control: "agent",
    url: "https://shop.example.com/cart",
    title: "Cart",
    waiting: "",
}

export const Connecting: Story = {args: {connection: {phase: "connecting"}}}

export const AgentControl: Story = {args: {connection: {phase: "live"}, status: page}}

export const UserControl: Story = {
    args: {connection: {phase: "live"}, status: {...page, control: "user"}},
}

/** The agent ran `agenta-browser wait`; only "I'm done" ends the wait. */
export const Waiting: Story = {
    args: {
        connection: {phase: "live"},
        status: {...page, control: "user", waiting: "Sign in to the shop, then click I'm done."},
    },
}

export const SignInExpired: Story = {args: {connection: closedBy(4401)}}

export const NoAccess: Story = {args: {connection: closedBy(4403)}}

export const NoBrowserRunning: Story = {args: {connection: closedBy(4404)}}
