import {useCallback, useState} from "react"
import {Drawer} from "antd"
import useDrawerWidth from "../../../hooks/useDrawerWidth"
import {GenerationFocusDrawerProps} from "./types"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import GenerationComparisionCompletionOuput from "../../PlaygroundGenerationComparisionView/GenerationComparisionCompletionOuput"
import GenerationFocusDrawerHeader from "./assets/GenerationFocusDrawerHeader"
import GenerationOutputNavigator from "./assets/GenerationOutputNavigator"
import clsx from "clsx"
import GenerationCompletionRow from "../../PlaygroundGenerations/assets/GenerationCompletionRow"
import {EnhancedVariant} from "@/components/PlaygroundTest/assets/utilities/transformer/types"
import {getEnhancedProperties} from "@/components/PlaygroundTest/assets/utilities/genericTransformer/utilities/enhanced"

const GenerationFocusDrawer: React.FC<GenerationFocusDrawerProps> = ({
    type,
    variantId,
    rowId,
    loadNextRow,
    loadPrevRow,
    inputRows,
    ...props
}) => {
    const [format, setFormat] = useState("pretty")
    const {drawerWidth} = useDrawerWidth()

    const {result, variableIds, runVariantTestRow, canRun, isRunning, displayedVariants, viewType} =
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
                        result: inputRow?.__result,
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
                    <GenerationComparisionCompletionOuput
                        key={variantId}
                        variantId={variantId}
                        focusDisable={true}
                        result={result}
                        isRunning={isRunning}
                        className={clsx("w-full", {"w-[400px]": viewType === "comparison"})}
                    />
                ))}
            </div>
        </Drawer>
    )
}

export default GenerationFocusDrawer
