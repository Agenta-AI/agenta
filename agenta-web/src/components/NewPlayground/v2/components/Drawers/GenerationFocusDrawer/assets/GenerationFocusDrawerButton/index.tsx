import {useCallback, useState} from "react"
import dynamic from "next/dynamic"
import {Button} from "antd"
import {ArrowsOut} from "@phosphor-icons/react"
import {GenerationFocusDrawerButtonProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"
const GenerationFocusDrawer = dynamic(() => import("../.."), {ssr: false})

const GenerationFocusDrawerButton = ({
    variantIds,
    rowId,
    children,
    icon = true,
    ...props
}: GenerationFocusDrawerButtonProps) => {
    const [_rowId, _setRowId] = useState(rowId)
    const [isOpenFocusDrawer, setIsOpenFocusDrawer] = useState(false)

    const {inputRows} = usePlayground({
        variantId: variantIds as string,
        variantSelector: useCallback(
            (variant: EnhancedVariant) => {
                const inputRows = variant.inputs?.value || []
                return {inputRows}
            },
            [_rowId],
        ),
    })

    const loadNextRow = useCallback(() => {
        if (_rowId) {
            const currentIndex = inputRows.findIndex((item) => item.__id === _rowId)
            if (currentIndex < inputRows.length - 1) {
                _setRowId(inputRows[currentIndex + 1].__id)
            }
        }
    }, [_rowId, inputRows])

    const loadPrevRow = useCallback(() => {
        if (_rowId) {
            const currentIndex = inputRows.findIndex((item) => item.__id === _rowId)
            if (currentIndex > 0) {
                _setRowId(inputRows[currentIndex - 1].__id)
            }
        }
    }, [_rowId, inputRows])

    return (
        <>
            <Button
                type="text"
                icon={icon && <ArrowsOut size={14} />}
                onClick={() => setIsOpenFocusDrawer(true)}
                {...props}
            >
                {children}
            </Button>

            {isOpenFocusDrawer && (
                <GenerationFocusDrawer
                    variantId={variantIds as string}
                    rowId={_rowId}
                    open={isOpenFocusDrawer}
                    onClose={() => setIsOpenFocusDrawer(false)}
                    loadNextRow={loadNextRow}
                    loadPrevRow={loadPrevRow}
                    inputRows={inputRows}
                    type="completion"
                />
            )}
        </>
    )
}

export default GenerationFocusDrawerButton
