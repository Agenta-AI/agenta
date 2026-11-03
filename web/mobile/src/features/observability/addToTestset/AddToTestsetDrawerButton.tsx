import {useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {DatabaseIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useAddToTestsetAccess} from "./useAddToTestsetAccess"

// A second split: the button renders in every trace drawer header, the sheet only after a click.
const AddToTestsetSheet = dynamic(() => import("./AddToTestsetSheet"), {ssr: false})

/**
 * The trace drawer's "Add to testset" slot. It adds the active span. It renders nothing while
 * the view is off or the user may not edit test sets.
 */
export const AddToTestsetDrawerButton = (props: Record<string, unknown>) => {
    const projectId = useAtomValue(projectIdAtom)
    const allowed = useAddToTestsetAccess(projectId)
    const [openFor, setOpenFor] = useState<readonly string[] | null>(null)
    if (!allowed) return null

    const spanIds = Array.isArray(props.spanIds)
        ? props.spanIds.filter((id): id is string => typeof id === "string" && Boolean(id))
        : []
    const label = typeof props.label === "string" ? props.label : "Add to testset"

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                disabled={Boolean(props.disabled) || spanIds.length === 0}
                onClick={() => setOpenFor(spanIds)}
            >
                <DatabaseIcon size={14} />
                {label}
            </Button>
            {openFor ? (
                <AddToTestsetSheet spanIds={openFor} onClose={() => setOpenFor(null)} />
            ) : null}
        </>
    )
}

export default AddToTestsetDrawerButton
