import {cloneElement, isValidElement, SetStateAction, useCallback, useState} from "react"

import {Database} from "@phosphor-icons/react"
import {Button} from "antd"
import dynamic from "next/dynamic"

import usePlayground from "@/oss/components/NewPlayground/hooks/usePlayground"
import {findVariantById} from "@/oss/components/NewPlayground/hooks/usePlayground/assets/helpers"
import {createMessageFromSchema} from "@/oss/components/NewPlayground/hooks/usePlayground/assets/messageHelpers"
import {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"
import {safeParse} from "@/oss/lib/helpers/utils"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import type {
    ArrayMetadata,
    Enhanced,
    ObjectMetadata,
} from "@/oss/lib/shared/variant/genericTransformer/types"
import {createInputRow} from "@/oss/lib/shared/variant/inputHelpers"

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
                const inputKeys = (variant?.prompts || []).flatMap((prompt) => {
                    const keys = prompt.inputKeys.value.map((key) => key.value)
                    return keys
                })

                return {isChat: state.variants[0]?.isChat, inputKeys: inputKeys}
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
                            const chatMessages = safeParse(row.messages)

                            const _metadata = getMetadataLazy<ArrayMetadata>(
                                messageRow.history.__metadata,
                            )
                            const messageMetadata = _metadata?.itemMetadata as ObjectMetadata

                            if (!messageMetadata) return

                            const newMessages = chatMessages?.map(
                                (chat: {role: string; content: string}) => {
                                    return createMessageFromSchema(messageMetadata, {
                                        role: chat?.role,
                                        content: chat?.content,
                                    })
                                },
                            )

                            messageRow.history.value = [...newMessages]

                            const generationMetadata = clonedState.generationData.inputs.__metadata
                            const parentMetadata =
                                getMetadataLazy<ArrayMetadata<ObjectMetadata>>(generationMetadata)
                            const inputMetadata = parentMetadata?.itemMetadata

                            if (!inputMetadata) return clonedState

                            const _inputKeys = Object.keys(inputMetadata.properties)
                            const newRow = createInputRow(_inputKeys, inputMetadata)

                            for (const key of _inputKeys as (keyof typeof newRow)[]) {
                                const newRowProperty = newRow[key] as Enhanced<string>
                                newRowProperty.value = row[key]
                            }

                            clonedState.generationData.inputs.value = [newRow]
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
                            for (const key of inputKeys as (keyof typeof newRow)[]) {
                                const newRowProperty = newRow[key] as Enhanced<string>
                                newRowProperty.value = row[key]
                            }

                            return newRow
                        })

                        clonedState.generationData.inputs.value = newGenerationRows.filter(
                            (row) => !!row,
                        )

                        return clonedState
                    }
                },
                {revalidate: false},
            )

            setTestsetData(d)
        },
        [inputKeys, isChat, mutate],
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
