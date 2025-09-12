import {useMemo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import {usePlaygroundLayout} from "../../hooks/usePlaygroundLayout"
import {playgroundStateAtom} from "../../state/atoms"
import {isChatVariantAtomFamily} from "../../state/atoms/propertySelectors"

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
    const firstDisplayedId = displayedVariants?.[0] || ""
    const isChatSelector = useMemo(
        () => isChatVariantAtomFamily(firstDisplayedId),
        [firstDisplayedId],
    )
    const isChatVariant = useAtomValue(isChatSelector)

    const {isChat} = useMemo(() => {
        return {isChat: isChatVariant}
    }, [isChatVariant])

    return (
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
