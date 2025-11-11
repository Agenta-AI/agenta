import {memo, useCallback, useEffect} from "react"
import dynamic from "next/dynamic"

import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {PlaygroundStateData} from "@/oss/components/Playground/hooks/usePlayground/types"
import VariantTag from "../../../assets/VariantTag"
import {EnrichedEvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"
import EvalNameTag from "../../../assets/EvalNameTag"
import {PromptConfigCardSkeleton} from "./EvalRunPromptConfigViewerSkeleton"
import PlaygroundVariantCustomProperties from "@/oss/components/Playground/Components/PlaygroundVariantCustomProperties"

const PlaygroundVariantConfigPrompt = dynamic(
    () => import("@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"),
    {ssr: false, loading: () => <PromptConfigCardSkeleton />},
)
const DeployVariantButton = dynamic(
    () =>
        import(
            "@/oss/components/Playground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"
        ),
    {ssr: false},
)

const PromptConfigCard = ({
    variantId,
    evaluation,
}: {
    variantId: string
    evaluation: EnrichedEvaluationRun
}) => {
    const {
        isFetching: isLoading,
        selected,
        promptIds,
        selectedVariant,
        setDisplayedVariants,
    } = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const revision = state.variants.find((v) => state.selected?.includes(v._revisionId))

                return {
                    selected: state.selected,
                    selectedVariant: revision,
                    isFetching: state.fetching,
                    isDirty: state.dirtyStates?.[revision?._revisionId as string],
                    promptIds: revision?.prompts?.map((p: any) => p.__id) || [],
                }
            },
            [variantId],
        ),
    })

    useEffect(() => {
        if (!selectedVariant && selected?.length) {
            setDisplayedVariants?.(selected)
        }
    }, [selectedVariant, selected])

    return (
        <div className="flex flex-col border border-solid border-[#0517290F] w-full rounded overflow-hidden">
            <div className="h-[48px] flex items-center justify-between py-2 px-2 border-0 border-b border-solid border-[#EAEFF5]">
                <div className="flex items-center gap-2">
                    <EvalNameTag color="blue" name={evaluation?.name} />
                    <VariantTag
                        variantName={selectedVariant?.name!}
                        revision={selectedVariant?.revision!}
                        id={selectedVariant?._revisionId}
                    />
                </div>

                <DeployVariantButton revisionId={variantId} />
            </div>
            {isLoading || isLoading === undefined ? (
                <PromptConfigCardSkeleton />
            ) : (
                <>
                    {(promptIds || [])?.map((promptId: string) => (
                        <PlaygroundVariantConfigPrompt
                            key={promptId}
                            promptId={promptId}
                            variantId={variantId}
                            size="small"
                            viewOnly
                        />
                    ))}
                    <PlaygroundVariantCustomProperties
                        variantId={selectedVariant?._revisionId!}
                        initialOpen={promptIds?.length === 0}
                    />
                </>
            )}
        </div>
    )
}

export default memo(PromptConfigCard)
