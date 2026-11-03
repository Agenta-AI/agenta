// @vitest-environment jsdom
//
// Below `lg` the header kebab is the ONLY tap that reaches an agent's configuration on this app.
//
// The Configuration card lives in a rail the overview hides below that breakpoint, on purpose:
// stacked under the activity list the three cards read as a second page. So the kebab carries
// "Open configuration" there and drops it above the breakpoint, where the card's own Edit is
// already on screen and offering the same trip twice is noise.
//
// That makes this the route to the MCP servers section, which lives in the agent's configuration
// rather than in settings, and with it the add-server and permission drawers. Nothing pinned it:
// dropping the prop, or widening the query, took the section off the phone entirely and left
// every suite green.
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentOverviewTitle} from "@/features/agents/AgentOverviewTitle"

/** Records what the shared kebab was handed, which is the whole question here. */
const menuProps = vi.hoisted(() => ({current: null as Record<string, unknown> | null}))

vi.mock("@agenta/entity-ui/agent", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/entity-ui/agent")>()
    return {
        ...actual,
        AgentActionsMenu: (props: Record<string, unknown>) => {
            menuProps.current = props
            return null
        },
        AgentChip: () => null,
        AgentIconPopover: ({children}: {children?: React.ReactNode}) => <>{children}</>,
        useRenameAgent: () => () => undefined,
        useUpdateAgentDescription: () => () => undefined,
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

/** `useMediaQuery` reads `matchMedia`, which jsdom does not implement. */
const setViewportWide = (wide: boolean) => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: (query: string) => ({
            matches: wide && query.includes("1024"),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        }),
    })
}

let host: HTMLDivElement
let root: Root

const render = async (wide: boolean, pending = false) => {
    setViewportWide(wide)
    menuProps.current = null
    const onEditConfig = vi.fn()
    await act(async () =>
        root.render(
            <AgentOverviewTitle
                agentId="agent-1"
                name="Changelog writer"
                description={null}
                pending={pending}
                onOpenChat={() => undefined}
                onEditConfig={onEditConfig}
            />,
        ),
    )
    return {onEditConfig}
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the route into an agent's configuration", () => {
    it("offers Open configuration on the kebab below the breakpoint", async () => {
        const {onEditConfig} = await render(false)

        const onOpen = menuProps.current?.onOpen
        expect(onOpen, "the kebab was given no Open action on a phone").toBeTypeOf("function")
        ;(onOpen as () => void)()
        expect(onEditConfig).toHaveBeenCalledOnce()
    })

    it("drops it above the breakpoint, where the card's own Edit is on screen", async () => {
        await render(true)

        expect(menuProps.current?.onOpen).toBeUndefined()
    })

    it("draws no kebab at all until the agent's record lands", async () => {
        // The destructive verbs would act on an agent whose name is not known yet.
        await render(false, true)

        expect(menuProps.current).toBeNull()
    })
})
