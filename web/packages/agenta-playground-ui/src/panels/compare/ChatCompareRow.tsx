import {memo, useMemo, type ReactNode} from "react"

import {executionItemController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

import {ChatControls} from "../chat/ChatControls"
import {ChatMessage} from "../chat/ChatMessage"
import {ChatTurn} from "../chat/ChatTurn"
import {InputsList} from "../inputs"

import {LEAD_COLUMN, REVISION_COLUMN} from "./columns"
import {OutputLabel} from "./CompareRowsHeader"

export interface ChatCompareRowProps {
    turnId: string
    isFirstTurn: boolean
    isLastTurn: boolean
    revisionIds: string[]
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
    renderTraceFooter?: (traceId: string) => ReactNode
}

/**
 * One chat turn across every revision. The input column holds what all revisions share: the
 * prompt's variables (first turn), the user message, and under the last turn the Run and
 * "+ Message" controls. Each revision's column holds its reply. Run and Re-run send the turn to
 * every revision.
 */
export const ChatCompareRow = memo(
    ({
        turnId,
        isFirstTurn,
        isLastTurn,
        revisionIds,
        templateFormat,
        renderTraceFooter,
    }: ChatCompareRowProps) => {
        const variableRowIds = useAtomValue(
            executionItemController.selectors.generationVariableRowIds,
        ) as string[]
        const busy = useAtomValue(
            useMemo(
                () => executionItemController.selectors.isBusyForRow({rowId: turnId}),
                [turnId],
            ),
        )
        const triggerTests = useSetAtom(executionItemController.actions.triggerTests)
        const cancelRow = useSetAtom(executionItemController.actions.cancelRow)
        const rerunFromTurn = useSetAtom(executionItemController.actions.rerunFromTurn)
        const addUserMessage = useSetAtom(executionItemController.actions.addUserMessage)

        return (
            <div
                data-testid={`compare-row-${turnId}`}
                className="flex flex-col md:min-w-fit md:flex-row"
            >
                <div className={`${LEAD_COLUMN} flex flex-col gap-3 border-b p-3`}>
                    {isFirstTurn
                        ? variableRowIds.map((rowId) => (
                              <InputsList
                                  key={rowId}
                                  rowId={rowId}
                                  templateFormat={templateFormat}
                              />
                          ))
                        : null}
                    <ChatMessage
                        entityId={revisionIds[0]}
                        rowId={turnId}
                        kind="user"
                        onRerun={() =>
                            rerunFromTurn({
                                turnId,
                                executionIds: revisionIds,
                                userMessageId: turnId,
                            })
                        }
                    />
                    {isLastTurn ? (
                        <ChatControls
                            isRunning={busy}
                            onRun={() =>
                                triggerTests({executionIds: revisionIds, step: {id: turnId}})
                            }
                            onCancel={() => cancelRow({rowId: turnId})}
                            onAddMessage={() => addUserMessage({userMessage: null})}
                        />
                    ) : null}
                </div>
                {revisionIds.map((revisionId) => (
                    <div
                        key={revisionId}
                        data-testid={`compare-output-${turnId}-${revisionId}`}
                        className={`${REVISION_COLUMN} border-b p-3`}
                    >
                        <OutputLabel revisionId={revisionId} />
                        <ChatTurn
                            entityId={revisionId}
                            turnId={turnId}
                            isLastTurn={isLastTurn}
                            hideUserMessage
                            renderTraceFooter={renderTraceFooter}
                        />
                    </div>
                ))}
            </div>
        )
    },
)
ChatCompareRow.displayName = "ChatCompareRow"
