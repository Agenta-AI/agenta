// @vitest-environment jsdom
import React, {act} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Radix portals and pointer handling are not what these tests check: render the menu inline.
vi.mock("@agenta/ui/ui", () => {
    const Wrap = ({children}: {children: React.ReactNode}) => <div>{children}</div>
    return {
        Button: ({children, ...props}: React.ComponentProps<"button">) => (
            <button {...props}>{children}</button>
        ),
        DropdownMenu: Wrap,
        DropdownMenuTrigger: Wrap,
        DropdownMenuContent: Wrap,
        DropdownMenuItem: ({
            children,
            onSelect,
            disabled,
            ...props
        }: {
            children: React.ReactNode
            onSelect: () => void
            disabled?: boolean
            "data-testid"?: string
        }) => (
            <div
                role="menuitem"
                aria-disabled={disabled}
                data-testid={props["data-testid"]}
                onClick={() => (disabled ? undefined : onSelect())}
            >
                {children}
            </div>
        ),
    }
})

import {EMPTY_CONNECTIONS} from "../../src/channels/helpers"
import type {ChannelConnection, ChannelConnections} from "../../src/channels/types"
import {buildPublishItems} from "../../src/publish/items"
import {PublishMenu, liveSummary, type PublishMenuItem} from "../../src/publish/PublishMenu"

const AGENT = "agent-1"

const connection = (overrides: Partial<ChannelConnection> = {}): ChannelConnection => ({
    connectionId: "c1",
    platform: "slack",
    kind: "hosted",
    status: "connected",
    dm: "allow",
    group: "allow",
    chats: [],
    agent: {id: AGENT, name: "Agent"},
    ...overrides,
})

describe("buildPublishItems", () => {
    it("offers Slack, Telegram, WhatsApp and API in order; API is live once the agent is saved", () => {
        const items = buildPublishItems({
            connections: EMPTY_CONNECTIONS,
            agentId: AGENT,
        })
        expect(items.map((item) => [item.key, item.live])).toEqual([
            ["slack", false],
            ["telegram", false],
            ["whatsapp", false],
            ["api", true],
        ])
    })

    it("marks a connection answering as this agent live", () => {
        const connections: ChannelConnections = {
            slack: connection(),
            telegram: connection({platform: "telegram"}),
            whatsapp: null,
        }
        const items = buildPublishItems({connections, agentId: AGENT})
        expect(items.filter((item) => item.live).map((item) => item.key)).toEqual([
            "slack",
            "telegram",
            "api",
        ])
    })

    it("shows the API as Set up while the agent has no saved id (draft)", () => {
        const [, , , api] = buildPublishItems({
            connections: EMPTY_CONNECTIONS,
            agentId: undefined,
        })
        expect(api).toMatchObject({key: "api", live: false})
    })

    it("lets the host override the API's live state explicitly", () => {
        const [, , , api] = buildPublishItems({
            connections: EMPTY_CONNECTIONS,
            agentId: AGENT,
            apiLive: false,
        })
        expect(api).toMatchObject({key: "api", live: false})
    })

    it("does not count pending, revoked or another agent's connection as live", () => {
        const cases: ChannelConnection[] = [
            connection({status: "pending"}),
            connection({status: "revoked"}),
            connection({agent: {id: "other", name: "Other"}}),
            connection({agent: null}),
        ]
        for (const slack of cases) {
            const [item] = buildPublishItems({
                connections: {slack, telegram: null, whatsapp: null},
                agentId: AGENT,
            })
            expect(item).toMatchObject({key: "slack", live: false})
        }
    })

    it("disables the channel items while their connections are unavailable", () => {
        const items = buildPublishItems({
            connections: EMPTY_CONNECTIONS,
            agentId: AGENT,
            channelsUnavailable: true,
        })
        expect(items.map((item) => [item.key, !!item.disabled])).toEqual([
            ["slack", true],
            ["telegram", true],
            ["whatsapp", true],
            ["api", false],
        ])
    })
})

describe("PublishMenu", () => {
    let root: Root
    let container: HTMLDivElement
    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.append(container)
        root = createRoot(container)
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
    })

    const render = async (items: PublishMenuItem[], onSelect = vi.fn()) => {
        await act(async () => root.render(<PublishMenu items={items} onSelect={onSelect} />))
        return onSelect
    }
    const item = (key: string) =>
        container.querySelector(`[data-testid="publish-item-${key}"]`) as HTMLElement | null

    it("shows exactly the three items with Set up and Live statuses", async () => {
        await render([
            {key: "slack", live: true},
            {key: "telegram", live: false},
            {key: "api", live: false},
        ])
        expect(container.querySelector('[data-testid="publish-button"]')?.textContent).toBe(
            "1Publish",
        )
        const rows = [...container.querySelectorAll('[role="menuitem"]')].map(
            (row) => row.textContent,
        )
        expect(rows).toEqual(["SlackLive", "TelegramSet up", "APISet up"])
    })

    it("shows the live summary only when something is live", async () => {
        await render([
            {key: "slack", live: false},
            {key: "telegram", live: false},
            {key: "api", live: false},
        ])
        expect(container.querySelector('[data-testid="publish-live-summary"]')).toBeNull()

        await render([
            {key: "slack", live: true},
            {key: "telegram", live: true},
            {key: "api", live: false},
        ])
        expect(container.querySelector('[data-testid="publish-live-summary"]')?.textContent).toBe(
            "Live in 2 places",
        )
    })

    it("counts the API toward the live summary, e.g. Live in 3 places", async () => {
        await render([
            {key: "slack", live: true},
            {key: "telegram", live: true},
            {key: "api", live: true},
        ])
        expect(container.querySelector('[data-testid="publish-live-summary"]')?.textContent).toBe(
            "Live in 3 places",
        )
    })

    it("keeps the sentence off a phone header and puts a compact count on the button", async () => {
        await render([
            {key: "slack", live: true},
            {key: "telegram", live: true},
            {key: "api", live: true},
        ])
        const summary = container.querySelector('[data-testid="publish-live-summary"]')
        // Hidden below `sm`, shown from it: the phone header has no room for the sentence.
        expect(summary?.className).toMatch(/(^|\s)hidden(\s|$)/)
        expect(summary?.className).toContain("sm:inline-flex")

        const count = container.querySelector('[data-testid="publish-live-count"]')
        expect(count?.textContent).toBe("3")
        expect(count?.className).toContain("sm:hidden")
        expect(
            container.querySelector('[data-testid="publish-button"]')?.getAttribute("aria-label"),
        ).toBe("Publish, live in 3 places")
    })

    it("shows no count on the button when nothing is live", async () => {
        await render([
            {key: "slack", live: false},
            {key: "api", live: false},
        ])
        expect(container.querySelector('[data-testid="publish-live-count"]')).toBeNull()
        const button = container.querySelector('[data-testid="publish-button"]')
        expect(button?.textContent).toBe("Publish")
        expect(button?.hasAttribute("aria-label")).toBe(false)
    })

    it("reports the chosen target and ignores a disabled one", async () => {
        const onSelect = await render([
            {key: "slack", live: false, disabled: true},
            {key: "api", live: false},
        ])
        await act(async () => item("slack")?.click())
        await act(async () => item("api")?.click())
        expect(onSelect.mock.calls).toEqual([["api"]])
    })

    it("uses the singular for one place", () => {
        expect(liveSummary(1)).toBe("Live in 1 place")
        expect(liveSummary(3)).toBe("Live in 3 places")
    })
})
