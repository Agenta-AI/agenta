import {projectIdAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {DatabaseIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useAddToTestsetAction} from "./useAddToTestsetAction"

/** The slot props are untyped, so the span ids are read with care. */
const spanIdsOf = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string" && Boolean(id))
        : []

/**
 * The trace drawer's "Add to testset" slot. It adds the active span. It renders nothing while
 * the view is off or the user may not edit test sets.
 */
export const AddToTestsetDrawerButton = (props: Record<string, unknown>) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const {testsetAction, sheet} = useAddToTestsetAction(projectId, spanIdsOf(props.spanIds))
    if (!testsetAction) return null

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                disabled={Boolean(props.disabled) || testsetAction.disabled}
                onClick={testsetAction.onSelect}
            >
                <DatabaseIcon size={14} />
                {typeof props.label === "string" ? props.label : "Add to testset"}
            </Button>
            {sheet}
        </>
    )
}

export default AddToTestsetDrawerButton
