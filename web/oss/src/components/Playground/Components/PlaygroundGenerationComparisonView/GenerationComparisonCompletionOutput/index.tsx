import {useMemo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import {generationResultAtomFamily} from "@/oss/components/Playground/state/atoms"
import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import ErrorPanel from "../../PlaygroundGenerations/assets/GenerationCompletionRow/ErrorPanel"
import GenerationResponsePanel from "../../PlaygroundGenerations/assets/GenerationCompletionRow/GenerationResponsePanel"
import {
    RunningPlaceholder,
    ClickRunPlaceholder,
} from "../../PlaygroundGenerations/assets/ResultPlaceholder"

import type {GenerationComparisonCompletionOutputProps} from "./types"

const GenerationComparisonCompletionOutput = ({
    rowId,
    variantId,
    variantIndex,
    isLastRow,
}: GenerationComparisonCompletionOutputProps) => {
    const {
        resultHash,
        isRunning,
        result: inlineResult,
    } = useAtomValue(
        useMemo(() => generationResultAtomFamily({variantId, rowId}), [variantId, rowId]),
    ) as any

    const result = useMemo(
        () => inlineResult ?? getResponseLazy(resultHash),
        [inlineResult, resultHash],
    )

    return (
        <>
            {variantIndex === 0 ? (
                <div
                    className={clsx([
                        "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[3] !w-[400px]",
                        {"border-r": variantIndex === 0},
                        "shrink-0",
                    ])}
                >
                    <div className="w-full flex-1 shrink-0 sticky top-9 z-[2] border-0">
                        <GenerationCompletion
                            rowId={rowId}
                            // variantId={variantId}
                            withControls={isLastRow}
                        />
                    </div>
                </div>
            ) : null}

            <div
                className={clsx([
                    "!min-w-[400px] flex-1 shrink-0",
                    "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                ])}
            >
                <div className="!w-full shrink-0 sticky top-9 z-[2]">
                    {isRunning ? (
                        <RunningPlaceholder />
                    ) : result ? (
                        result.error ? (
                            <ErrorPanel result={result} />
                        ) : (
                            <GenerationResponsePanel result={result} />
                        )
                    ) : (
                        <ClickRunPlaceholder />
                    )}
                </div>
            </div>
        </>
    )
}

export default GenerationComparisonCompletionOutput
