import type {ReactNode} from "react"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import type {AgentActivityTab} from "./agentActivityView"

const TAB_BASE =
    "box-border cursor-pointer appearance-none border-0 border-b-2 border-solid bg-transparent px-0.5 pb-2.5 font-[inherit] text-[15px] leading-none outline-none transition-colors " +
    FOCUS_RING
const TAB_ON = "border-b-foreground font-semibold text-foreground"
const TAB_OFF = "border-b-transparent font-normal text-muted-foreground hover:text-foreground"

const TABS: {key: AgentActivityTab; label: string}[] = [
    {key: "sessions", label: "Sessions"},
    // Co-equal with Sessions, not a filter of it: a run is one the user configured but did not start.
    {key: "runs", label: "Automations"},
]

/** The activity list's rail: two tabs on a rule, Home's tab language, with the list's control at the far end. */
export const AgentActivityTabs = ({
    tab,
    onChange,
    actions,
}: {
    tab: AgentActivityTab
    onChange: (tab: AgentActivityTab) => void
    /** The filter menu, sitting on the rule's right. */
    actions?: ReactNode
}) => (
    <div
        role="tablist"
        className="mb-1.5 flex items-end gap-6 border-0 border-b border-solid border-b-[var(--ag-colorSplit)]"
    >
        {TABS.map((entry) => (
            <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={entry.key === tab}
                onClick={() => onChange(entry.key)}
                // `-mb-px` sits the active rule on the rail's rule, not above it.
                className={cn(TAB_BASE, "-mb-px", entry.key === tab ? TAB_ON : TAB_OFF)}
            >
                {entry.label}
            </button>
        ))}
        {actions ? <span className="mb-2 ml-auto flex items-center">{actions}</span> : null}
    </div>
)
