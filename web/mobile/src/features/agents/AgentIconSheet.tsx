import {useEffect, useState} from "react"

import {agentIconAtomFamily} from "@agenta/entities/workflow"
import {
    AGENT_ICON_CHIP_CLASS,
    AgentIcon,
    DEFAULT_AGENT_ICON,
    agentIconChipStyle,
    loadAgentIconCatalog,
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
    /** Kept so picking a colour before an icon still writes a glyph, not an empty path. */
    const [seedPath, setSeedPath] = useState<string | null>(null)

    const color = record?.color ?? DEFAULT_AGENT_ICON.color
    const iconName = record?.icon ?? DEFAULT_AGENT_ICON.icon
    const path = record?.path ?? seedPath ?? ""

    // The default glyph has to come from the catalog too, so picking a colour before an icon is not
    // stored against an empty path. Only while the sheet is open — the catalog is a lazy chunk.
    useEffect(() => {
        if (!open || record?.path) return
        let alive = true
        loadAgentIconCatalog().then(
            (entries) => {
                if (alive) setSeedPath(entries.find((e) => e.name === iconName)?.path ?? "")
            },
            () => undefined,
        )
        return () => {
            alive = false
        }
    }, [open, record?.path, iconName])

    const commit = (next: Partial<{icon: string; color: string; path: string}>) =>
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

                <div className="flex flex-col gap-4 px-4">
                    <AgentIconSwatchRow
                        selected={record?.color ?? null}
                        onPick={(hex) => commit({color: hex})}
                    />
                    <AgentIconGrid
                        selectedName={record ? iconName : ""}
                        color={color}
                        onPick={(entry: PhosphorCatalogEntry) =>
                            commit({icon: entry.name, path: entry.path})
                        }
                    />
                </div>

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
