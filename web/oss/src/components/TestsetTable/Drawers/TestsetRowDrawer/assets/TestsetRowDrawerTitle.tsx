import React, {memo, useCallback} from "react"

import {
    CloseOutlined,
    FullscreenExitOutlined,
    FullscreenOutlined,
    SaveOutlined,
} from "@ant-design/icons"
import {CaretDown, CaretUp} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

interface TestsetRowDrawerTitleProps {
    rowIndex: number
    totalRows: number
    isDirty: boolean
    onClose: () => void
    onSave: () => void
    onNavigate: (direction: "prev" | "next") => void
    onToggleWidth: () => void
    isExpanded: boolean
}

const TestsetRowDrawerTitle: React.FC<TestsetRowDrawerTitleProps> = ({
    rowIndex,
    totalRows,
    isDirty,
    onClose,
    onSave,
    onNavigate,
    onToggleWidth,
    isExpanded,
}) => {
    const isDisablePrev = rowIndex === 0
    const isDisableNext = rowIndex === totalRows - 1

    const handlePrev = useCallback(() => {
        if (!isDisablePrev) {
            onNavigate("prev")
        }
    }, [isDisablePrev, onNavigate])

    const handleNext = useCallback(() => {
        if (!isDisableNext) {
            onNavigate("next")
        }
    }, [isDisableNext, onNavigate])

    return (
        <section className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
                <Button onClick={onClose} type="text" icon={<CloseOutlined />} size="small" />
                <Button
                    onClick={onToggleWidth}
                    type="text"
                    size="small"
                    icon={isExpanded ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                />

                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <Button
                            icon={<CaretUp size={16} />}
                            size="small"
                            type="text"
                            onClick={handlePrev}
                            disabled={isDisablePrev}
                        />
                        <Button
                            icon={<CaretDown size={16} />}
                            size="small"
                            type="text"
                            onClick={handleNext}
                            disabled={isDisableNext}
                        />
                    </div>

                    <Typography.Text strong>Row {rowIndex + 1}</Typography.Text>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    type="primary"
                    size="small"
                    icon={<SaveOutlined />}
                    onClick={onSave}
                    disabled={!isDirty}
                >
                    Save
                </Button>
            </div>
        </section>
    )
}

export default memo(TestsetRowDrawerTitle)
