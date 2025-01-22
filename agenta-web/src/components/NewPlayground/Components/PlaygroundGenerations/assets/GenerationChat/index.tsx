import {useCallback} from "react"

import {Typography} from "antd"
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
import RunButton from "@/components/NewPlayground/assets/RunButton"

const GenerationChat = ({variantId, viewAs}: GenerationChatProps) => {
    const {mutate, inputRowIds, messageRowIds, runTests, viewType} = usePlayground({
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
    const isComparisonView = viewType === "comparison"

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

    return (
        <section className="flex flex-col">
            {/* Variables */}
            {!viewAs || viewAs === "input"
                ? inputRowIds.map((inputRowId) => {
                      return (
                          <GenerationCompletionRow
                              key={inputRowId}
                              variantId={variantId}
                              rowId={inputRowId}
                              inputOnly={true}
                              className={clsx([
                                  {
                                      "bg-[#f5f7fa] border-0 border-r border-solid border-[rgba(5,23,41,0.06)]":
                                          isComparisonView,
                                  },
                              ])}
                          />
                      )
                  })
                : null}

            {/* Prompt chats */}
            <div
                className={clsx([
                    "flex flex-col gap-4 p-4 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    {"!border-none !p-0 !gap-0": isComparisonView},
                    {"bg-[#f5f7fa]": isComparisonView && viewAs === "input"},
                ])}
            >
                <div className="flex flex-col gap-1">
                    {!isComparisonView && <Typography>Chat</Typography>}

                    <div className={clsx(["flex flex-col gap-5", {"!gap-0": isComparisonView}])}>
                        {messageRowIds.map((messageRow) => (
                            <GenerationChatRow
                                key={messageRow}
                                variantId={variantId}
                                rowId={messageRow}
                                disabled={true}
                                viewAs={viewAs}
                            />
                        ))}
                    </div>
                </div>

                {!viewAs || viewAs === "input" ? (
                    <div
                        className={clsx([
                            {
                                "flex items-center h-[48px] px-4 border-0 border-b border-r border-solid border-[rgba(5,23,41,0.06)]":
                                    isComparisonView,
                            },
                        ])}
                    >
                        <RunButton size="small" onClick={() => runTests?.()} className="flex" />
                    </div>
                ) : null}
            </div>

            <div className={clsx(["flex items-center gap-2 px-4 mt-5"])}>
                <AddButton size="small" label="Message" onClick={addNewMessageRow} />
            </div>
        </section>
    )
}

export default GenerationChat
