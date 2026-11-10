import type {Meta, StoryObj} from "@storybook/nextjs"

import {BrowserTabStrip} from "../../../packages/agenta-entity-ui/src/browser/BrowserTabStrip"

/** The browser pane's header while the agent's browser has several tabs open. */
const meta = {
    title: "@agenta/entity-ui/Browser/BrowserTabStrip",
    component: BrowserTabStrip,
    parameters: {layout: "padded"},
    args: {onSelect: () => {}},
} satisfies Meta<typeof BrowserTabStrip>

export default meta
type Story = StoryObj<typeof BrowserTabStrip>

const tabs = [
    {id: 1, title: "Cart", url: "https://shop.example.com/cart", active: true},
    {id: 2, title: "Pricing", url: "https://example.com/pricing", active: false},
    {id: 3, title: "", url: "https://docs.example.com/", active: false},
]

export const TwoTabs: Story = {args: {tabs: tabs.slice(0, 2)}}

export const UntitledTab: Story = {args: {tabs}}

export const Overflowing: Story = {
    args: {
        tabs: Array.from({length: 8}, (_, index) => ({
            id: index + 1,
            title: `A long page title for tab ${index + 1}`,
            url: "https://example.com/",
            active: index === 6,
        })),
    },
    decorators: [
        (Story) => (
            <div className="w-[420px]">
                <Story />
            </div>
        ),
    ],
}
