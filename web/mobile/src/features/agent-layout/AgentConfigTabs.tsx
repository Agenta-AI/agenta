import type {ReactNode} from "react"

import {cn} from "@agenta/ui/styles"
import {BackLink, Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"

import type {PaneBack} from "./paneBack"

/** The id of the panel the agent pane's tabs control. */
export const AGENT_CONFIG_TABPANEL_ID = "agent-config-tabpanel"

export const agentConfigTabId = (key: string) => `agent-config-tab-${key}`

export interface AgentConfigTab<K extends string> {
    key: K
    label: string
    /** After the label: a "changed" dot, a count. */
    adornment?: ReactNode
}

/**
 * The agent pane's tab row: the kit Tabs in the pane header (48 px), or under the phone header
 * (40 px). Selection runs on click, so the arrow keys move focus and Enter or Space selects.
 * While a view inside a tab is open (`back`), the header is its back link instead.
 */
export const AgentConfigTabs = <K extends string>({
    tabs,
    value,
    onSelect,
    phone = false,
    back = null,
    trailing,
}: {
    tabs: AgentConfigTab<K>[]
    value: K
    onSelect: (key: K) => void
    phone?: boolean
    back?: PaneBack | null
    /** At the end of the row: Close. */
    trailing?: ReactNode
}) => {
    if (back)
        return (
            // The same header as a Configuration view: the way back, then Close.
            <div className="flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted pl-2 pr-3">
                <div className="flex min-w-0 flex-1 items-center pl-1.5">
                    <BackLink
                        size="bar"
                        title={back.title}
                        onClick={back.onBack}
                        className="max-w-full"
                    >
                        <span className="truncate">{back.title}</span>
                    </BackLink>
                </div>
                {trailing}
            </div>
        )
    return (
        <Tabs
            value={value}
            activationMode="manual"
            className={cn(
                "box-border shrink-0 flex-row items-center justify-between border-0 border-b border-solid border-border-muted",
                phone ? "h-10 gap-1 pl-1.5 pr-4" : "h-12 gap-2 pl-3.5 pr-3",
            )}
        >
            <TabsList
                className={cn(
                    // In a narrow pane the tabs and Close do not fit: the row scrolls, never overlaps.
                    "ag-scroll-no-bar min-w-0 shrink justify-start overflow-x-auto",
                    // The full header height, so the underline sits on the header's bottom line.
                    "h-auto self-stretch",
                )}
            >
                {tabs.map((tab) => (
                    <TabsTrigger
                        key={tab.key}
                        value={tab.key}
                        id={agentConfigTabId(tab.key)}
                        aria-controls={AGENT_CONFIG_TABPANEL_ID}
                        className="flex-none"
                        onClick={() => onSelect(tab.key)}
                    >
                        {tab.label}
                        {tab.adornment}
                    </TabsTrigger>
                ))}
            </TabsList>
            {trailing}
        </Tabs>
    )
}
