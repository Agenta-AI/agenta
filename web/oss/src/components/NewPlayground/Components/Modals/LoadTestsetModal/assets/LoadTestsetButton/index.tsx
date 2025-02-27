import {cloneElement, isValidElement, SetStateAction, useCallback, useState} from "react"

import {Database} from "@phosphor-icons/react"
import {Button} from "antd"
import dynamic from "next/dynamic"

import {
    ArrayMetadata,
    Enhanced,
    EnhancedObjectConfig,
    ObjectMetadata,
} from "@/oss/components/NewPlayground/assets/utilities/genericTransformer/types"
import {InputType} from "@/oss/components/NewPlayground/assets/utilities/transformer/types/input"
import usePlayground from "@/oss/components/NewPlayground/hooks/usePlayground"
import {findVariantById} from "@/oss/components/NewPlayground/hooks/usePlayground/assets/helpers"
import {createInputRow} from "@/oss/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import {createMessageFromSchema} from "@/oss/components/NewPlayground/hooks/usePlayground/assets/messageHelpers"
import {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"
import {getMetadataLazy} from "@/oss/components/NewPlayground/state"

import {LoadTestsetButtonProps} from "./types"

const LoadTestsetModal = dynamic(() => import("../.."), {ssr: false})

const LoadTestsetButton = ({
    label,
    icon = false,
    children,
    variantId,
    ...props
}: LoadTestsetButtonProps) => {
    const {mutate, isChat, inputKeys} = usePlayground({
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const _variantId = variantId || state.selected[0]
                const variant = findVariantById(state, _variantId)
                const inputKeys = variant?.prompts.flatMap((prompt) => {
                    const keys = prompt.inputKeys.value.map((key) => key.value)
                    return keys
                })

                return {isChat: state.variants[0].isChat, inputKeys: inputKeys}
            },
            [variantId],
        ),
    })

    const [isTestsetModalOpen, setIsTestsetModalOpen] = useState(false)
    const [testsetData, setTestsetData] = useState<Record<string, any> | null>(null)

    const wrappedSetTestsetData = useCallback(
        (d: SetStateAction<Record<string, any> | null>) => {
            const data = Array.isArray(d) ? d : [d]

            mutate(
                (clonedState) => {
                    if (!clonedState) return clonedState

                    if (isChat) {
                        const messageRow = clonedState.generationData.messages.value[0]
                        if (!messageRow) return clonedState

                        data.forEach((row) => {
                            const chatMessages = inputKeys
                                ?.map((key) => {
                                    if (row[key] && typeof row[key] === "string") {
                                        return {content: row[key]}
                                    }
                                    return null
                                })
                                .filter(Boolean)

                            const _metadata = getMetadataLazy<ArrayMetadata>(
                                messageRow.history.__metadata,
                            )
                            const itemMetadata = _metadata?.itemMetadata as ObjectMetadata

                            if (!itemMetadata) return

                            const newMessages = chatMessages?.map((chat) => {
                                return createMessageFromSchema(itemMetadata, {
                                    role: "user",
                                    content: chat?.content,
                                })
                            })

                            messageRow.history.value.push(...newMessages)
                        })

                        return clonedState
                    } else {
                        // access the existing generation metadata to pull correct keys from testset rows
                        const generationMetadata = clonedState.generationData.inputs.__metadata

                        // loop through the testset rows and create new generation rows from them
                        const newGenerationRows = data.map((row) => {
                            const parentMetadata =
                                getMetadataLazy<ArrayMetadata<ObjectMetadata>>(generationMetadata)
                            const metadata = parentMetadata?.itemMetadata

                            if (!metadata) return null

                            const inputKeys = Object.keys(metadata.properties)
                            const newRow = createInputRow(inputKeys, metadata)

                            // set the values of the new generation row inputs to the values of the testset row
                            for (const key of inputKeys) {
                                const newRowProperty = newRow[key] as Enhanced<string>
                                newRowProperty.value = row[key]
                            }

                            return newRow
                        })

                        clonedState.generationData.inputs.value = newGenerationRows.filter(
                            (row) => !!row,
                        ) as EnhancedObjectConfig<InputType<string[]>>[]

                        return clonedState
                    }
                },
                {revalidate: false},
            )

            setTestsetData(d)
        },
        [inputKeys],
    )

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsTestsetModalOpen(true)
                        },
                    },
                )
            ) : (
                <Button
                    size="small"
                    icon={icon && <Database size={14} />}
                    onClick={() => setIsTestsetModalOpen(true)}
                    {...props}
                >
                    {label}
                </Button>
            )}

            <LoadTestsetModal
                open={isTestsetModalOpen}
                onCancel={() => setIsTestsetModalOpen(false)}
                testsetData={testsetData}
                setTestsetData={wrappedSetTestsetData}
                isChat={isChat}
            />
        </>
    )
}

export default LoadTestsetButton
