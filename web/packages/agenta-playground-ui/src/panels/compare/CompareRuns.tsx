import {useMemo, type ReactNode} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {executionController, executionItemController} from "@agenta/playground"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {useChatConfigMessages} from "../../hooks/useChatConfigMessages"
import {readTemplateFormat} from "../runs/CompletionRows"

import {ChatCompareRow} from "./ChatCompareRow"
import {LEAD_COLUMN} from "./columns"
import {CompareRowsHeader} from "./CompareRowsHeader"
import {CompletionCompareRow} from "./CompletionCompareRow"

export interface CompareRunsProps {
    revisionIds: string[]
    renderTraceFooter?: (traceId: string) => ReactNode
}

/**
 * The rows of the compare view: the header row, then one row per test case (completion) or per
 * turn (chat). The first revision's prompt decides the variable syntax, as in the single view.
 */
export const CompareRuns = ({revisionIds, renderTraceFooter}: CompareRunsProps) => {
    const isChat = useAtomValue(executionController.selectors.isChatMode)
    const rowIds = useAtomValue(executionItemController.selectors.executionRowIds) as string[]
    const addRow = useSetAtom(executionItemController.actions.addRow)
    const primaryId = revisionIds[0]
    const parameters = useAtomValue(workflowMolecule.selectors.data(primaryId))?.data?.parameters
    const completionFormat = useMemo(
        () => readTemplateFormat(parameters as Record<string, unknown> | undefined),
        [parameters],
    )
    const chatFormat = useChatConfigMessages(primaryId).templateFormat

    if (isChat === undefined) return null

    return (
        <div className="flex flex-col md:min-w-fit">
            <CompareRowsHeader revisionIds={revisionIds} />
            {isChat
                ? rowIds.map((turnId, index) => (
                      <ChatCompareRow
                          key={turnId}
                          turnId={turnId}
                          isFirstTurn={index === 0}
                          isLastTurn={index === rowIds.length - 1}
                          revisionIds={revisionIds}
                          templateFormat={chatFormat}
                          renderTraceFooter={renderTraceFooter}
                      />
                  ))
                : rowIds.map((rowId, index) => (
                      <CompletionCompareRow
                          key={rowId}
                          rowId={rowId}
                          index={index}
                          revisionIds={revisionIds}
                          canRemove={rowIds.length > 1}
                          templateFormat={completionFormat}
                          renderTraceFooter={renderTraceFooter}
                      />
                  ))}
            {isChat ? null : (
                <div className={`${LEAD_COLUMN} border-r-0 bg-transparent px-3 py-3`}>
                    <Button variant="outline" size="sm" onClick={() => addRow()}>
                        <Plus />
                        Test case
                    </Button>
                </div>
            )}
        </div>
    )
}
