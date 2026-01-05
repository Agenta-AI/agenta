import {useCallback, useMemo} from "react"

import {atom, useAtomValue, useSetAtom} from "jotai"

import {loadingByRowRevisionAtomFamily} from "@/oss/state/newPlayground/generation/runtime"
import {triggerWebWorkerTestAtom} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

import {usePlaygroundLayout} from "../../../../hooks/usePlaygroundLayout"
import {
    appChatModeAtom,
    cancelTestsMutationAtom,
    displayedVariantsAtom,
} from "../../../../state/atoms"
import {
    resolvedGenerationResultAtomFamily,
    generationRunStatusAtomFamily,
} from "../../../../state/atoms/generationProperties"

import DefaultView from "./DefaultView"
import SingleView from "./SingleView"
import type {GenerationCompletionRowProps} from "./types"

// Keep dynamic imports local to presentational components

const GenerationCompletionRow = ({
    variantId,
    rowId,
    className,
    inputOnly,
    view,
    disabled,
    forceSingle,
    ...props
}: GenerationCompletionRowProps) => {
    const isChat = useAtomValue(appChatModeAtom)

    // Only subscribe to generation result atoms in completion mode
    const generationResultAtom = useMemo(
        () => resolvedGenerationResultAtomFamily({variantId, rowId}),
        [variantId, rowId],
    )

    // Always call the hook (React hooks rule), but only use result in completion mode
    const generationResultValue = useAtomValue(generationResultAtom) as any
    const resultState = !isChat ? generationResultValue : ({} as any)
    const resultHash = resultState?.resultHash as string | null
    const isRunning = Boolean(resultState?.isRunning)
    const resultFromAtom = resultState?.result

    const displayedVariantIds = useAtomValue(displayedVariantsAtom)
    const isBusy = useAtomValue(
        useMemo(
            () =>
                atom((get) => {
                    if (isChat) return false
                    if (variantId) {
                        const {isRunning: variantRunning} = get(
                            generationRunStatusAtomFamily({variantId, rowId}),
                        )
                        const variantLoading = get(
                            loadingByRowRevisionAtomFamily({rowId, revisionId: variantId}),
                        )
                        return Boolean(variantRunning || variantLoading)
                    }

                    const ids = Array.isArray(displayedVariantIds) ? displayedVariantIds : []
                    return ids.some((vid) => {
                        const {isRunning: variantRunning} = get(
                            generationRunStatusAtomFamily({variantId: vid, rowId}),
                        )
                        const variantLoading = get(
                            loadingByRowRevisionAtomFamily({rowId, revisionId: vid}),
                        )
                        return Boolean(variantRunning || variantLoading)
                    })
                }),
            [displayedVariantIds, isChat, rowId, variantId],
        ),
    )
    const {isComparisonView} = usePlaygroundLayout()
    const viewType = isComparisonView ? "comparison" : "single"
    const triggerTest = useSetAtom(triggerWebWorkerTestAtom)
    const cancelTests = useSetAtom(cancelTestsMutationAtom)

    const result = !isChat ? resultFromAtom : undefined

    const runRow = useCallback(async () => {
        // In comparison view with no explicit variantId, trigger for all displayed variants
        if (!variantId && Array.isArray(displayedVariantIds) && displayedVariantIds.length > 0) {
            displayedVariantIds.forEach((vid) => {
                triggerTest({rowId, variantId: vid} as any)
            })
            return
        }
        // Single view or explicit variant run
        triggerTest({rowId, variantId: variantId as string})
    }, [triggerTest, rowId, variantId, displayedVariantIds])

    const cancelRow = useCallback(async () => {
        const variantIds = viewType === "single" && variantId ? [variantId] : displayedVariantIds
        await cancelTests({rowId, variantIds, reason: "user_cancelled"} as any)
    }, [cancelTests, displayedVariantIds, variantId, viewType, rowId])

    // Single view content
    return forceSingle || (viewType === "single" && view !== "focus" && variantId) ? (
        <SingleView
            rowId={rowId}
            variantId={variantId}
            isChat={isChat}
            isBusy={isBusy}
            isRunning={!!isRunning}
            inputOnly={inputOnly}
            result={result}
            resultHash={resultHash}
            runRow={runRow}
            cancelRow={cancelRow}
            containerClassName={
                "border-0 border-t border-b border-solid border-colorBorderSecondary"
            }
        />
    ) : (
        <DefaultView
            rowId={rowId}
            variantId={variantId}
            isChat={isChat}
            viewType={viewType as any}
            view={view}
            disabled={disabled}
            inputOnly={inputOnly}
            resultHash={resultHash}
            runRow={runRow}
            cancelRow={cancelRow}
            isBusy={isBusy}
        />
    )
}

export default GenerationCompletionRow
