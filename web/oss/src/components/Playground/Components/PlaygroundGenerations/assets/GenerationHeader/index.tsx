import {useCallback, useEffect, useState} from "react"

import {Button, Tooltip, Typography, Modal, message} from "antd"
import clsx from "clsx"
import {Eye, Copy} from "@phosphor-icons/react"

import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {findVariantById} from "@/oss/components/Playground/hooks/usePlayground/assets/helpers"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {getAllMetadata, getSpecLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import RunButton from "../../../../assets/RunButton"
import {clearRuns} from "../../../../hooks/usePlayground/assets/generationHelpers"
import type {PlaygroundStateData} from "../../../../hooks/usePlayground/types"
import TestsetDrawerButton from "../../../Drawers/TestsetDrawer"
import LoadTestsetButton from "../../../Modals/LoadTestsetModal/assets/LoadTestsetButton"

import {useStyles} from "./styles"
import type {GenerationHeaderProps} from "./types"

const GenerationHeader = ({variantId}: GenerationHeaderProps) => {
    const classes = useStyles()
    const [previewOpen, setPreviewOpen] = useState(false)
    const [previewJson, setPreviewJson] = useState<string>("")
    
    const {resultHashes, isRunning, mutate, runTests, cancelRunTests, data} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const variant = findVariantById(state, variantId)

                if (variant?.isChat) {
                    const messageRows = state.generationData.messages.value

                    const resultHashes = messageRows
                        .flatMap((message) => {
                            const historyArray = message.history.value
                            return historyArray.map(
                                (history) => history.__runs?.[variantId]?.__result,
                            )
                        })
                        .filter(Boolean)

                    const isRunning = messageRows.some((inputRow) =>
                        inputRow.history.value.some((history) =>
                            variantId ? history.__runs?.[variantId]?.__isRunning : false,
                        ),
                    )
                    return {resultHashes, isRunning, data: state}
                } else {
                    const inputRows = state.generationData.inputs.value

                    const resultHashes = (inputRows || []).map((inputRow) =>
                        variantId ? inputRow?.__runs?.[variantId]?.__result : null,
                    )

                    const isRunning = (inputRows || []).some((inputRow) =>
                        variantId ? inputRow?.__runs?.[variantId]?.__isRunning : false,
                    )

                    return {resultHashes, isRunning, data: state}
                }
            },
            [variantId],
        ),
    })

    const handlePreview = useCallback(() => {
        if (!data) return
        
        const variant = findVariantById(data, variantId)
        if (!variant) return
        
        const spec = getSpecLazy()
        const allMetadata = getAllMetadata()
        const inputRow = data.generationData.inputs.value[0]
        const messageRow = data.generationData.messages.value?.[0]
        
        try {
            const requestBody = transformToRequestBody({
                variant,
                inputRow,
                messageRow: variant.isChat ? messageRow : undefined,
                allMetadata,
                spec,
                routePath: data.uri?.routePath,
            })
            
            setPreviewJson(JSON.stringify(requestBody, null, 2))
            setPreviewOpen(true)
        } catch (error) {
            message.error("Failed to generate preview")
            console.error("Preview error:", error)
        }
    }, [data, variantId])

    const handleCopyToClipboard = useCallback(() => {
        navigator.clipboard.writeText(previewJson)
        message.success("Request body copied to clipboard!")
    }, [previewJson])

    const clearGeneration = useCallback(() => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState
                clearRuns(clonedState)
                return clonedState
            },
            {revalidate: false},
        )
    }, [mutate])

    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                if (!isRunning) runTests?.()
            }
        }
        document.addEventListener("keydown", listener, true)
        return () => {
            document.removeEventListener("keydown", listener, true)
        }
    }, [runTests, isRunning])

    return (
        <section
            className={clsx(
                "h-[48px] flex justify-between items-center gap-4 sticky top-0 z-10",
                classes.container,
            )}
        >
            <Typography className="text-[16px] leading-[18px] font-[600] text-nowrap">
                Generations
            </Typography>

            <div className="flex items-center gap-2">
                <Tooltip title="Clear all">
                    <Button size="small" onClick={clearGeneration} disabled={isRunning}>
                        Clear
                    </Button>
                </Tooltip>

                <LoadTestsetButton label="Load test set" variantId={variantId} />

                <Tooltip title="Preview API Request">
                    <Button 
                        size="small" 
                        icon={<Eye size={14} />} 
                        onClick={handlePreview}
                        disabled={isRunning}
                    >
                        Preview
                    </Button>
                </Tooltip>

                <TestsetDrawerButton
                    label="Add all to test set"
                    icon={false}
                    size="small"
                    disabled={isRunning}
                    resultHashes={resultHashes}
                />

                {!isRunning ? (
                    <Tooltip title="Run all (Ctrl+Enter / ⌘+Enter)">
                        <RunButton
                            isRunAll
                            type="primary"
                            onClick={() => runTests?.()}
                            disabled={isRunning}
                        />
                    </Tooltip>
                ) : (
                    <RunButton isCancel onClick={() => cancelRunTests?.()} className="flex" />
                )}
            </div>
            
            <Modal
                title="API Request Preview"
                open={previewOpen}
                onCancel={() => setPreviewOpen(false)}
                width={800}
                footer={[
                    <Button key="copy" icon={<Copy size={14} />} onClick={handleCopyToClipboard}>
                        Copy to Clipboard
                    </Button>,
                    <Button key="close" onClick={() => setPreviewOpen(false)}>
                        Close
                    </Button>
                ]}
            >
                <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[60vh]">
                    {previewJson}
                </pre>
            </Modal>
        </section>
    )
}

export default GenerationHeader
