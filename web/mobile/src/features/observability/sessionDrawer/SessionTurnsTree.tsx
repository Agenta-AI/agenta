import {useCallback, useMemo, useState} from "react"

import type {TraceSpanNode} from "@agenta/observability"
import {TraceRow} from "@agenta/observability-ui"
import {CustomTreeComponent, TraceTreeSettings} from "@agenta/observability-ui/traceDrawer"
import {Input, Popover, PopoverContent, PopoverTrigger, Button} from "@agenta/ui/ui"
import {MagnifyingGlass, SlidersHorizontal} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {observabilitySessionTreeSettingsAtom} from "./sessionDrawerPreferences"
import {buildSessionTree, type SessionStats, type SessionTreeNode} from "./sessionTurns"

interface SessionTurnsTreeProps {
    /** The traces, oldest first. */
    traces: TraceSpanNode[]
    stats: SessionStats | null
    selectedKey: string
    onSelect: (key: string) => void
}

/** The "Session" root over one "Trace n" node per trace, with a search and the row settings. */
export const SessionTurnsTree = ({traces, stats, selectedKey, onSelect}: SessionTurnsTreeProps) => {
    const [search, setSearch] = useState("")
    const [settings, setSettings] = useAtom(observabilitySessionTreeSettingsAtom)
    const tree = useMemo(() => buildSessionTree(traces, stats, search), [traces, stats, search])

    const renderLabel = useCallback(
        (node: SessionTreeNode) => <TraceRow span={node} metrics={settings} className="text-xs" />,
        [settings],
    )

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="session-tree">
            <div className="box-border flex h-10 shrink-0 items-center gap-2 border-0 border-b border-solid border-border pl-4 pr-2">
                <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
                <Input
                    placeholder="Search in session"
                    className="w-full border-0 bg-transparent shadow-none focus-visible:ring-0"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Tree settings">
                            <SlidersHorizontal size={14} />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="end" className="!p-0 w-[240px]">
                        <TraceTreeSettings settings={settings} setSettings={setSettings} />
                    </PopoverContent>
                </Popover>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {tree ? (
                    <CustomTreeComponent
                        data={tree}
                        getKey={(node) => node.span_id}
                        getChildren={(node) => node.children as SessionTreeNode[] | undefined}
                        renderLabel={renderLabel}
                        selectedKey={selectedKey}
                        onSelect={onSelect}
                        defaultExpanded
                    />
                ) : null}
            </div>
        </div>
    )
}
