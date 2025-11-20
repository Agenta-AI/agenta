import {memo, useEffect, useMemo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {evaluationRunStateAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import PromptConfigCard from "./assets/PromptConfigCard"

const EvalRunPromptConfigViewer = () => {
    const evaluation = useAtomValue(evaluationRunStateAtom)
    const enrichedRun = evaluation?.enrichedRun

    const revisions = useMemo(() => {
        const variants = enrichedRun?.variants
        return variants?.map((v) => v._revisionId)
    }, [enrichedRun])

    const {isLoading, setDisplayedVariants} = usePlayground()

    useEffect(() => {
        if (isLoading || !revisions?.length) return

        setDisplayedVariants?.(revisions)
    }, [isLoading, revisions])

    return (
        <div className={clsx(["flex px-6"])}>
            {revisions?.map((v) => (
                <PromptConfigCard key={v} variantId={v} evaluation={enrichedRun!} />
            ))}
        </div>
    )
}

export default memo(EvalRunPromptConfigViewer)
