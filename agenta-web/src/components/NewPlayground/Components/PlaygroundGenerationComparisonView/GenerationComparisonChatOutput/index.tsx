import GenerationComparisonOutputHeader from "../assets/GenerationComparisonOutputHeader"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {useCallback} from "react"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import GenerationResultUtils from "../../PlaygroundGenerations/assets/GenerationResultUtils"
import {GenerationComparisonChatOutputProps, GenerationComparisonChatOutputRowProps} from "./types"
import clsx from "clsx"

const GenerationComparisonChatOutputRow = ({
    variantId,
    rowId,
}: GenerationComparisonChatOutputRowProps) => {
    const {message} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const messageRow = (state.generationData.messages.value || []).find((inputRow) => {
                    return inputRow.__id === rowId
                })

                return {message: messageRow?.value}
            },
            [rowId],
        ),
    })

    return (
        <div className="flex flex-col w-full">
            <div className="h-[48px] px-4 flex items-center border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
                <PlaygroundVariantPropertyControl
                    propertyId={message.role.__id}
                    variantId={variantId}
                    rowId={rowId}
                    as="SimpleDropdownSelect"
                    className="!border border-solid border-[rgba(5,23,41,0.06)] px-2 bg-white"
                />
            </div>

            <div className="h-[96px] px-4 py-2 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
                <GenerationOutputText
                    text={message.content.value}
                    className="w-full mt-1"
                    disabled={false}
                />
            </div>

            <div className="h-[48px] px-4 flex items-center border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
                <GenerationResultUtils result={{}} />
            </div>
        </div>
    )
}

const GenerationComparisonChatOutput = ({
    variantId,
    className,
    indexName,
}: GenerationComparisonChatOutputProps) => {
    const {messageRowIds} = usePlayground({
        variantId,
        stateSelector: useCallback((state: PlaygroundStateData) => {
            const messageRows = state.generationData.messages.value || []

            return {
                messageRowIds: (messageRows || []).map((messageRow) => messageRow.__id),
            }
        }, []),
    })

    return (
        <div className={clsx("flex flex-col w-full", className)}>
            <GenerationComparisonOutputHeader
                variantId={variantId}
                indexName={indexName}
                className="sticky top-0 z-[1]"
            />

            <section className="border-0 border-r border-solid border-[rgba(5,23,41,0.06)]">
                {messageRowIds.map((messageRow) => (
                    <GenerationComparisonChatOutputRow
                        key={messageRow}
                        variantId={variantId}
                        rowId={messageRow}
                    />
                ))}
            </section>
        </div>
    )
}

export default GenerationComparisonChatOutput
