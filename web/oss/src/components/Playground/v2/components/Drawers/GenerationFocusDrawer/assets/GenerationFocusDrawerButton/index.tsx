// @ts-nocheck
import {useCallback, useMemo, useState} from "react"

import {ArrowsOut} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {inputRowIdsAtom} from "@/oss/state/generation/entities"

import {GenerationFocusDrawerButtonProps} from "./types"
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

    const rowIds = useAtomValue(inputRowIdsAtom) as string[]
    const inputRows = useMemo(() => rowIds.map((id) => ({__id: id}) as any), [rowIds])

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
