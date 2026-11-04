import {useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {RevisionTree} from "./RevisionTree"

export interface RevisionSwitcherProps {
    /** The app whose variants and revisions the list shows. */
    appId: string
    /** The revision the playground shows now. */
    revisionId: string
    /** The reader picked another revision. */
    onSwitch: (revisionId: string) => void
}

const triggerLabel = ({
    pending,
    name,
}: {
    pending: boolean
    name: string | null | undefined
}): string => (pending ? "Loading..." : name || "Select variant")

/**
 * The variant name with a chevron. It opens the app's variants and their revisions; picking a
 * revision hands it to `onSwitch`.
 *
 * The list loads only once the popover opens, so a playground that never switches never fetches
 * the variants.
 */
export const RevisionSwitcher = ({appId, revisionId, onSwitch}: RevisionSwitcherProps) => {
    const [open, setOpen] = useState(false)
    const query = useAtomValue(workflowMolecule.selectors.query(revisionId))
    const name = useAtomValue(workflowMolecule.selectors.variantLabel(revisionId))

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="max-w-48 gap-1 px-2 font-medium"
                    aria-label="Switch revision"
                >
                    <span className="truncate">
                        {triggerLabel({pending: query.isPending, name})}
                    </span>
                    <CaretDown aria-hidden size={12} className="shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[296px] p-0">
                {open ? (
                    <RevisionTree
                        appId={appId}
                        selectedValue={revisionId}
                        onSelect={(id) => {
                            setOpen(false)
                            onSwitch(id)
                        }}
                    />
                ) : null}
            </PopoverContent>
        </Popover>
    )
}
