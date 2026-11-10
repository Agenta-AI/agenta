import type {ReactNode} from "react"

import {Button, CollapseCaret} from "@agenta/ui/ui"

/**
 * One part of the scenario in the drawer (its inputs, the app output, one evaluator): a title
 * that folds the part, tools on the right, then the values while it is open.
 */
export const ScenarioSection = ({
    label,
    title,
    collapsed,
    onToggle,
    tools,
    children,
}: {
    /** The section's accessible name. */
    label: string
    title: string
    collapsed: boolean
    onToggle: () => void
    tools?: ReactNode
    children: ReactNode
}) => (
    <section aria-label={label} className="flex flex-col gap-2">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <Button
                variant="ghost"
                size="sm"
                className="-ml-2 min-w-0 gap-1 px-2 aria-expanded:bg-transparent"
                aria-expanded={!collapsed}
                onClick={onToggle}
            >
                <CollapseCaret open={!collapsed} />
                <span className="truncate text-sm font-medium">{title}</span>
            </Button>
            {tools}
        </div>
        {collapsed ? null : children}
    </section>
)
