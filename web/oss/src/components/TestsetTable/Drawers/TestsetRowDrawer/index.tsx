import React, {useCallback, useState} from "react"

import {useAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"

import TestsetRowDrawerContent from "./assets/TestsetRowDrawerContent"
import TestsetRowDrawerTitle from "./assets/TestsetRowDrawerTitle"
import {
    closeTestsetRowDrawerAtom,
    resetTestsetRowDirtyAtom,
    testsetRowDrawerAtom,
} from "./store/testsetRowDrawerStore"

interface TestsetRowDrawerProps {
    onSave: (rowIndex: number, rowData: any) => void
    totalRows: number
    onNavigate: (currentIndex: number, direction: "prev" | "next") => void
}

const TestsetRowDrawer: React.FC<TestsetRowDrawerProps> = ({onSave, totalRows, onNavigate}) => {
    const [drawerState] = useAtom(testsetRowDrawerAtom)
    const [, closeDrawer] = useAtom(closeTestsetRowDrawerAtom)
    const [, resetDirty] = useAtom(resetTestsetRowDirtyAtom)

    const initialWidth = 850
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    const handleClose = useCallback(() => {
        if (drawerState.isDirty) {
            const confirmed = window.confirm(
                "You have unsaved changes. Are you sure you want to close?",
            )
            if (!confirmed) return
        }
        closeDrawer()
    }, [drawerState.isDirty, closeDrawer])

    const handleSave = useCallback(() => {
        if (drawerState.selectedRowIndex !== null && drawerState.rowData) {
            onSave(drawerState.selectedRowIndex, drawerState.rowData)
            resetDirty()
            closeDrawer()
        }
    }, [drawerState.selectedRowIndex, drawerState.rowData, onSave, resetDirty, closeDrawer])

    const handleNavigate = useCallback(
        (direction: "prev" | "next") => {
            if (drawerState.selectedRowIndex !== null) {
                onNavigate(drawerState.selectedRowIndex, direction)
            }
        },
        [drawerState.selectedRowIndex, onNavigate],
    )

    const toggleWidth = useCallback(() => {
        setDrawerWidth((width) => (width === initialWidth ? 1920 : initialWidth))
    }, [initialWidth])

    if (!drawerState.rowData || drawerState.selectedRowIndex === null) {
        return null
    }

    return (
        <EnhancedDrawer
            open={drawerState.open}
            onClose={handleClose}
            closeIcon={null}
            width={drawerWidth}
            mask={false}
            classNames={{body: "!p-0"}}
            title={
                <TestsetRowDrawerTitle
                    rowIndex={drawerState.selectedRowIndex}
                    totalRows={totalRows}
                    isDirty={drawerState.isDirty}
                    onClose={handleClose}
                    onSave={handleSave}
                    onNavigate={handleNavigate}
                    onToggleWidth={toggleWidth}
                    isExpanded={drawerWidth !== initialWidth}
                />
            }
        >
            <TestsetRowDrawerContent rowData={drawerState.rowData} />
        </EnhancedDrawer>
    )
}

export default TestsetRowDrawer
