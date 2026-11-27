import {useContext, type ReactNode} from "react"

import {cn} from "@agenta/ui/styles"
import {Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {PaneHeader} from "@agenta/ui/view-stack"

import type {PaneBack} from "./paneBack"
import {PanelChromeContext} from "./PanelViewChrome"

/** The id of the panel the agent pane's tabs control. */
export const AGENT_CONFIG_TABPANEL_ID = "agent-config-tabpanel"

export const agentConfigTabId = (key: string) => `agent-config-tab-${key}`

export interface AgentConfigTab<K extends string> {
    key: K
    label: string
    /** After the label: a "changed" dot, a count. */
    adornment?: ReactNode
}

/** The agent pane's tab row; a back link and title replace it while a tab view is open. */
export const AgentConfigTabs = <K extends string>({
    tabs,
    value,
    onSelect,
    phone = false,
    back = null,
    onClose,
}: {
    tabs: AgentConfigTab<K>[]
    value: K
    onSelect: (key: K) => void
    phone?: boolean
    back?: PaneBack | null
    /** Close at the end of the header. */
    onClose?: () => void
}) => {
    const {widen} = useContext(PanelChromeContext)
    if (back)
        return (
            <PaneHeader
                back={{title: back.title, onBack: back.onBack}}
                title={back.current}
                onWiden={
                    widen
                        ? {wide: widen.wide, onToggle: () => widen.setWide(!widen.wide)}
                        : undefined
                }
                onClose={onClose}
            />
        )
    const tabRow = (
        <Tabs
            value={value}
            activationMode="manual"
            className={cn(
                "box-border min-w-0 shrink-0 flex-row items-center justify-between gap-0",
                // The tab text on the pane's 16 px line; the trigger's fill hangs out by its padding.
                phone
                    ? "h-10 gap-1 border-0 border-b border-solid border-border-muted pl-1.25 pr-4"
                    : "-ml-2.75 self-stretch",
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
        </Tabs>
    )
    if (phone) return tabRow
    return <PaneHeader onClose={onClose}>{tabRow}</PaneHeader>
}
