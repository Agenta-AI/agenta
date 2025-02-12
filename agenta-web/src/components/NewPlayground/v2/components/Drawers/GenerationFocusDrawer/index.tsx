import {useCallback, useState} from "react"
import {Drawer} from "antd"

import {GenerationFocusDrawerProps, OutputFormat} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import GenerationFocusDrawerHeader from "./assets/GenerationFocusDrawerHeader"
import GenerationOutputNavigator from "./assets/GenerationOutputNavigator"
import clsx from "clsx"

import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"
import {getEnhancedProperties} from "@/components/NewPlayground/assets/utilities/genericTransformer/utilities/enhanced"
import useDrawerWidth from "@/components/NewPlayground/hooks/useDrawerWidth"
import GenerationCompletionRow from "@/components/NewPlayground/Components/PlaygroundGenerations/assets/GenerationCompletionRow"
import GenerationComparisonCompletionOutput from "@/components/NewPlayground/Components/PlaygroundGenerationComparisonView/GenerationComparisonCompletionOutput"

const GenerationFocusDrawer: React.FC<GenerationFocusDrawerProps> = ({
    type,
    variantId,
    rowId,
    loadNextRow,
    loadPrevRow,
    inputRows,
    ...props
}) => {
    const [format, setFormat] = useState<OutputFormat>("PRETTY")
    const {drawerWidth} = useDrawerWidth()

    const {variableIds, runVariantTestRow, canRun, isRunning, displayedVariants, viewType} =
        usePlayground({
            variantId,
            variantSelector: useCallback(
                (variant: EnhancedVariant) => {
                    const inputRow = (variant.inputs?.value || []).find((inputRow) => {
                        return inputRow.__id === rowId
                    })

                    const variables = getEnhancedProperties(inputRow)
                    const variableIds = variables.map((p) => p.__id)
                    const canRun = variables.reduce((acc, curr) => acc && !!curr.value, true)

                    return {
                        variableIds,
                        canRun,
                        isRunning: inputRow?.__isLoading,
                    }
                },
                [rowId],
            ),
        })

    const onClose = (e: any) => {
        props?.onClose?.(e)
    }

    const runRow = useCallback(async () => {
        await runVariantTestRow?.(rowId)
    }, [runVariantTestRow, rowId])

    return (
        <Drawer
            placement={"right"}
            width={drawerWidth}
            onClose={onClose}
            classNames={{body: "!p-0 !overflow-x-hidden"}}
            {...props}
            title={
                <GenerationFocusDrawerHeader
                    format={format}
                    setFormat={setFormat}
                    variantId={variantId}
                    runRow={runRow}
                    isRunning={isRunning}
                    loadNextRow={loadNextRow}
                    loadPrevRow={loadPrevRow}
                    inputRows={inputRows}
                    rowId={rowId}
                />
            }
        >
            <GenerationCompletionRow
                key={rowId}
                variantId={variantId}
                rowId={rowId}
                className="!border-none"
                inputOnly={true}
                view="focus"
            />
            <GenerationOutputNavigator />

            <div
                className={clsx("w-full flex items-start", {
                    "overflow-x-auto": viewType === "comparison",
                })}
            >
                {/*TODO: add support of multiple variants */}
                {(displayedVariants || []).map((variantId) => (
                    <GenerationComparisonCompletionOutput
                        key={variantId}
                        variantId={variantId}
                        focusDisable={true}
                        registerToWebWorker={props?.open}
                        isRunning={isRunning}
                        className={clsx("w-full", {
                            "min-w-[400px] flex-1": viewType === "comparison",
                        })}
                        format={format}
                    />
                ))}
            </div>
        </Drawer>
    )
}

export default GenerationFocusDrawer
