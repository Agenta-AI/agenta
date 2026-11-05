import {useMemo, useState} from "react"

import {
    createWorkflowRevisionAdapter,
    TreeSelectPopupContent,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"

export interface AppPickerProps {
    /** The connected app's name, or null when none is connected. */
    selectedLabel: string | null
    onSelect: (selection: WorkflowRevisionSelectionResult) => void
    size?: "sm" | "default"
}

/**
 * Picks the app an evaluator runs on: the apps (no evaluators), then their revisions. An app's
 * revisions load when the reader opens it, so opening the list fetches only the apps.
 */
export const AppPicker = ({selectedLabel, onSelect, size = "sm"}: AppPickerProps) => {
    const [open, setOpen] = useState(false)
    const adapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                skipVariantLevel: true,
                excludeRevisionZero: true,
                flags: {is_evaluator: false, is_feedback: false},
                parentLabel: "Application",
            }),
        [],
    )

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size={size} className="max-w-56 gap-1">
                    <span className="truncate">{selectedLabel ?? "Select app"}</span>
                    <CaretDown aria-hidden size={12} className="shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[296px] p-0">
                {open ? (
                    <TreeSelectPopupContent<WorkflowRevisionSelectionResult>
                        adapter={adapter}
                        defaultExpandAll={false}
                        onSelect={(selection) => {
                            setOpen(false)
                            onSelect(selection)
                        }}
                        width={280}
                        maxHeight={400}
                    />
                ) : null}
            </PopoverContent>
        </Popover>
    )
}
