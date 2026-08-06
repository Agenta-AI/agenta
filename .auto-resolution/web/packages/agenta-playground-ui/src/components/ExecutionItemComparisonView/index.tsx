import {useMemo} from "react"

import {executionController, executionItemController} from "@agenta/playground"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import GenerationComparisonChatOutput from "./GenerationComparisonChatOutput"
import GenerationComparisonCompletionOutput from "./GenerationComparisonCompletionOutput"

const GenerationComparisonOutput = ({
    rowId,
    isLastRow,
    isFirstRow,
}: {
    rowId: string
    isLastRow?: boolean
    isFirstRow?: boolean
}) => {
    const rowItems = useAtomValue(
        useMemo(() => executionItemController.selectors.itemsByRow(rowId), [rowId]),
    )
    const isChatVariant = useAtomValue(executionController.selectors.isChatMode)
    const isChat = isChatVariant

    return isChatVariant === undefined ? null : (
        <div className={clsx([{flex: !isChat}])}>
            {isChat ? (
                <GenerationComparisonChatOutput
                    key={rowId}
                    turnId={rowId}
                    isFirstRow={!!isFirstRow}
                />
            ) : (
                rowItems.map((item) => (
                    <GenerationComparisonCompletionOutput
                        key={item.key}
                        rowId={rowId}
                        entityId={item.executionId}
                        variantIndex={item.executionIndex}
                        isLastRow={isLastRow}
                        isLastVariant={item.isLastExecution}
                    />
                ))
            )}
        </div>
    )
}

export {GenerationComparisonOutput}

// Re-export sub-components (canonical names only)
export {default as GenerationComparisonChatOutput} from "./GenerationComparisonChatOutput"
export {default as GenerationComparisonCompletionOutput} from "./GenerationComparisonCompletionOutput"
export {default as GenerationComparisonInputHeader} from "./assets/GenerationComparisonInputHeader"
export {default as GenerationComparisonOutputHeader} from "./assets/GenerationComparisonOutputHeader"
