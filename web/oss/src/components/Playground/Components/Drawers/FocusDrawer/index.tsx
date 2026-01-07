import {useMemo} from "react"

import {CaretDoubleRight, CaretDown, CaretUp} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"

import {generationRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"

import {
    closePlaygroundFocusDrawerAtom,
    playgroundFocusDrawerAtom,
} from "@/oss/state/playgroundFocusDrawerAtom"

const FocusDrawerContent = dynamic(() => import("./components/FocusDrawerContent"), {ssr: false})

const {Text} = Typography

const PlaygroundFocusDrawer = () => {
    const [{isOpen, rowId}, setDrawerState] = useAtom(playgroundFocusDrawerAtom)
    const closeDrawer = useSetAtom(closePlaygroundFocusDrawerAtom)
    const rowIds = useAtomValue(generationRowIdsAtom)

    const currentRowIndex = useMemo(() => {
        return rowIds.indexOf(rowId || "")
    }, [rowIds, rowId])

    const handleNext = () => {
        if (currentRowIndex < rowIds.length - 1) {
            setDrawerState((prev) => ({...prev, rowId: rowIds[currentRowIndex + 1]}))
        }
    }

    const handlePrev = () => {
        if (currentRowIndex > 0) {
            setDrawerState((prev) => ({...prev, rowId: rowIds[currentRowIndex - 1]}))
        }
    }

    return (
        <EnhancedDrawer
            open={isOpen}
            onClose={closeDrawer}
            closeIcon={null}
            title={
                <div className="flex items-center gap-2">
                    <Button icon={<CaretDoubleRight size={14} />} size="small" type="text" onClick={closeDrawer} />
                    <div className="flex items-center">
                        <Button
                            type="text"
                            icon={<CaretUp size={16} />}
                            onClick={handlePrev}
                            disabled={currentRowIndex <= 0}
                            size="small"
                        />
                        <Button
                            type="text"
                            icon={<CaretDown size={16} />}
                            onClick={handleNext}
                            disabled={currentRowIndex >= rowIds.length - 1}
                            size="small"
                        />
                    </div>
                    <Text className="text-sm font-medium">Focus Drawer</Text>
                </div>
            }
            width={800}
            className="[&_.ant-drawer-body]:!p-0"
            resizable
        >
            <FocusDrawerContent />
        </EnhancedDrawer>
    )
}

export default PlaygroundFocusDrawer
