import {useMemo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import {usePlaygroundLayout} from "../../hooks/usePlaygroundLayout"
import {appChatModeAtom} from "../../state/atoms"

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
    // Use atom-based state management
    const {displayedVariants} = usePlaygroundLayout()
    const isChatVariant = useAtomValue(appChatModeAtom)
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
                displayedVariants?.map((variantId, variantIndex) => (
                    <GenerationComparisonCompletionOutput
                        key={`${variantId}-${rowId}`}
                        rowId={rowId}
                        variantId={variantId}
                        variantIndex={variantIndex}
                        isLastRow={isLastRow}
                        isLastVariant={variantIndex === (displayedVariants || []).length - 1}
                    />
                ))
            )}
        </div>
    )
}

export {GenerationComparisonOutput}
