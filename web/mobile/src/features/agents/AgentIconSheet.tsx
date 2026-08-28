import {useMemo} from "react"

import {agentIconAtomFamily, type AgentIconRecord} from "@agenta/entities/workflow"
import {
    AGENT_ICON_CHIP_CLASS,
    AgentIcon,
    DEFAULT_AGENT_ICON,
    agentIconChipStyle,
    type PhosphorCatalogEntry,
} from "@agenta/ui/agent-icon"
import {useAtom} from "jotai"

import {Button} from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

import {AgentIconGrid} from "./AgentIconGrid"
import {AgentIconSwatchRow} from "./AgentIconSwatchRow"
import {AgentIconGridError, AgentIconGridLoading} from "./states/AgentIconStates"
import {useAgentIconCatalog} from "./useAgentIconCatalog"

/**
 * Pick one agent's glyph and colour.
 *
 * A sheet rather than the desktop's popover: that one is a fixed 300px panel with a saturation
 * square and a hue strip, none of which survives a thumb. The catalog, the palette and the stored
 * record are the same on both — only the layout is mobile's.
 *
 * Saves as you pick, like the desktop. The footer closes; it does not confirm.
 */
export const AgentIconSheet = ({
    workflowId,
    open,
    onClose,
}: {
    workflowId: string
    open: boolean
    onClose: () => void
}) => {
    const [record, setRecord] = useAtom(agentIconAtomFamily(workflowId))
    const catalog = useAgentIconCatalog(open)

    const color = record?.color ?? DEFAULT_AGENT_ICON.color
    const iconName = record?.icon ?? DEFAULT_AGENT_ICON.icon

    /** A stored record carries its glyph; before that it comes from the catalog, so a colour picked
     * first is never written against an empty path — the record guard would reject it on read. */
    const path = useMemo(
        () => record?.path ?? catalog.entries?.find((entry) => entry.name === iconName)?.path ?? "",
        [record?.path, catalog.entries, iconName],
    )

    const commit = (next: Partial<AgentIconRecord>) =>
        setRecord({icon: iconName, color, path, ...next})

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose()
            }}
        >
            <SheetContent side="responsive">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2.5">
                        <span
                            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${AGENT_ICON_CHIP_CLASS}`}
                            style={agentIconChipStyle(color)}
                        >
                            {path ? <AgentIcon path={path} size={18} /> : null}
                        </span>
                        Agent icon
                    </SheetTitle>
                    <SheetDescription>Saves as you pick.</SheetDescription>
                </SheetHeader>

                {/* Nothing is pickable until the catalog lands: a colour committed against an empty
                    path stores a record the guard rejects, so the pick would vanish silently. */}
                {catalog.failed ? (
                    <AgentIconGridError onRetry={catalog.retry} />
                ) : !catalog.entries ? (
                    <AgentIconGridLoading />
                ) : (
                    <div className="flex flex-col gap-4 px-4">
                        <AgentIconSwatchRow
                            selected={record?.color ?? null}
                            onPick={(hex) => commit({color: hex})}
                        />
                        <AgentIconGrid
                            entries={catalog.entries}
                            selectedName={record ? iconName : ""}
                            color={color}
                            onPick={(entry: PhosphorCatalogEntry) =>
                                commit({icon: entry.name, path: entry.path})
                            }
                        />
                    </div>
                )}

                <SheetFooter>
                    <Button onClick={onClose}>Done</Button>
                    {record ? (
                        <Button variant="outline" onClick={() => setRecord(null)}>
                            Reset
                        </Button>
                    ) : null}
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
