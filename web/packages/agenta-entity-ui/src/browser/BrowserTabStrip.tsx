import {useEffect, useRef, type ReactNode} from "react"

import {SessionTab, SessionTabStrip, TAB_DIVIDER} from "@agenta/sessions-ui/tabs"

import type {BrowserLiveTab} from "./live"

const tabLabel = ({title, url}: BrowserLiveTab) => {
    if (title) return title
    try {
        return new URL(url).host || "New tab"
    } catch {
        return "New tab"
    }
}

/** The pane's header with several tabs open: the app's tab chips, in place of the page title. */
export const BrowserTabStrip = ({
    tabs,
    onSelect,
    leading,
    trailing,
}: {
    tabs: BrowserLiveTab[]
    /** Not called for the tab on screen: picking a tab takes control, like the address bar. */
    onSelect: (id: number) => void
    leading?: ReactNode
    trailing?: ReactNode
}) => {
    const activeRef = useRef<HTMLDivElement | null>(null)
    const activeId = tabs.find((tab) => tab.active)?.id

    // The agent can move to a tab scrolled out of the strip.
    useEffect(() => {
        activeRef.current?.scrollIntoView?.({block: "nearest", inline: "nearest"})
    }, [activeId])

    return (
        <SessionTabStrip
            className="px-2"
            leadingExtra={leading}
            extra={trailing}
            remeasureKey={tabs.length}
        >
            {tabs.map((tab, index) => (
                <div
                    key={tab.id}
                    ref={tab.active ? activeRef : undefined}
                    className={`shrink-0 ${index ? `ml-[9px] ${TAB_DIVIDER}` : ""}`}
                >
                    <SessionTab
                        active={tab.active}
                        label={tabLabel(tab)}
                        title={tab.url}
                        onSelect={() => {
                            if (!tab.active) onSelect(tab.id)
                        }}
                    />
                </div>
            ))}
        </SessionTabStrip>
    )
}
