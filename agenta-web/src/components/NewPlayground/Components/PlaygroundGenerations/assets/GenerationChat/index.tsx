import {useCallback} from "react"

import {Typography} from "antd"
import {Plus} from "@phosphor-icons/react"
import clsx from "clsx"

import GenerationCompletionRow from "../GenerationCompletionRow"
import GenerationChatRow from "../GenerationChatRow"
import AddButton from "../../../../assets/AddButton"
import {getMetadataLazy} from "../../../../state"

import usePlayground from "../../../../hooks/usePlayground"

import type {GenerationChatProps} from "./types"
import type {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import type {
    ArrayMetadata,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {
    createMessageFromSchema,
    createMessageRow,
} from "@/components/NewPlayground/hooks/usePlayground/assets/messageHelpers"

const GenerationChat = ({variantId}: GenerationChatProps) => {
    const {mutate, inputRowIds, messageRowIds} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        stateSelector: useCallback((state: PlaygroundStateData) => {
            const inputRows = state.generationData.inputs.value || []
            const messageRows = state.generationData.messages.value || []

            return {
                inputRowIds: (inputRows || []).map((inputRow) => inputRow.__id),
                messageRowIds: (messageRows || []).map((messageRow) => messageRow.__id),
            }
        }, []),
    })

    const addNewMessageRow = useCallback(() => {
        mutate((clonedState) => {
            if (!clonedState) return clonedState

            const _metadata = getMetadataLazy<ArrayMetadata>(
                clonedState?.generationData.messages.__metadata,
            )

            const itemMetadata = _metadata?.itemMetadata as ObjectMetadata

            if (!itemMetadata) return clonedState

            const emptyMessage = createMessageFromSchema(itemMetadata)

            const newRow = createMessageRow(emptyMessage, itemMetadata)

            clonedState.generationData.messages.value.push(newRow)

            console.log("clonedState.generationData.messages", clonedState.generationData.messages)

            return clonedState
        })
    }, [mutate])

    console.log("messageRowIds", messageRowIds)

    return (
        <section className="flex flex-col">
            {inputRowIds.map((inputRowId) => {
                return (
                    <GenerationCompletionRow
                        key={inputRowId}
                        variantId={variantId}
                        rowId={inputRowId}
                        inputOnly={true}
                    />
                )
            })}

            <div className="flex flex-col gap-4 p-4 border-0 border-b border-solid border-[rgba(5,23,41,0.06)] group/item">
                <div className="flex flex-col gap-1">
                    <Typography>Chat</Typography>
                    <div className="flex flex-col gap-6">
                        {messageRowIds.map((messageRow) => (
                            <GenerationChatRow
                                key={messageRow}
                                variantId={variantId}
                                rowId={messageRow}
                                disabled={true}
                                type="output"
                            />
                        ))}
                    </div>
                </div>

                <div className="w-full flex gap-2 items-center cursor-pointer invisible group-hover/item:visible">
                    <div className="w-1/2 h-[1px] bg-[rgba(5,23,41,0.06)]" />
                    <Plus size={16} />
                    <div className="w-1/2 h-[1px] bg-[rgba(5,23,41,0.06)]" />
                </div>

                {/* TODO: properly support input on the GenerationChatRow  */}
                {/* <div className="flex flex-col gap-6">
                    <GenerationChatRow variantId={variantId} message={messages[1]} type="input" />
                </div> */}
            </div>

            <div className={clsx(["flex items-center gap-2 px-4 mt-5"])}>
                <AddButton size="small" label="Message" onClick={addNewMessageRow} />
            </div>
        </section>
    )
}

export default GenerationChat
