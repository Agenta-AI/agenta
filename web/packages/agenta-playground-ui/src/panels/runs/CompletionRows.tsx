import {useMemo, type ReactNode} from "react"

import {resolveTemplateFormat} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {executionItemController} from "@agenta/playground"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {CompletionRow} from "./CompletionRow"

/** The prompt's template format, so a chat-shaped input tokenizes the right `{{...}}` syntax. */
const readTemplateFormat = (
    parameters: Record<string, unknown> | undefined,
): "mustache" | "curly" | "fstring" | "jinja2" => {
    const prompt = parameters?.prompt as Record<string, unknown> | undefined
    const raw = (prompt?.template_format ??
        prompt?.templateFormat ??
        parameters?.template_format ??
        parameters?.templateFormat) as string | undefined
    return resolveTemplateFormat(raw) ?? "curly"
}

export interface CompletionRowsProps {
    entityId: string
    renderTraceFooter?: (traceId: string) => ReactNode
}

/** The test case rows of a completion app, in order, with the button that adds one. */
export const CompletionRows = ({entityId, renderTraceFooter}: CompletionRowsProps) => {
    const rowIds = useAtomValue(
        useMemo(() => executionItemController.selectors.rowIdsForEntity(entityId), [entityId]),
    )
    const addRow = useSetAtom(executionItemController.actions.addRow)
    const parameters = useAtomValue(workflowMolecule.selectors.data(entityId))?.data?.parameters
    const templateFormat = useMemo(
        () => readTemplateFormat(parameters as Record<string, unknown> | undefined),
        [parameters],
    )

    return (
        <div className="flex flex-col">
            {rowIds.map((rowId, index) => (
                <CompletionRow
                    key={rowId}
                    entityId={entityId}
                    rowId={rowId}
                    index={index}
                    canRemove={rowIds.length > 1}
                    templateFormat={templateFormat}
                    renderTraceFooter={renderTraceFooter}
                />
            ))}
            <div className="px-4 py-3">
                <Button variant="outline" size="sm" onClick={() => addRow()}>
                    <Plus />
                    Test case
                </Button>
            </div>
        </div>
    )
}
