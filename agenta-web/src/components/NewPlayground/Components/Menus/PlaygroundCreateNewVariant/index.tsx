import {useMemo, useState} from "react"

import {Popover, type PopoverProps} from "antd"

import AddButton from "../../../assets/AddButton"
import CreateNewVariantList from "./assets/CreateNewVariantList"

import type {PlaygroundCreateNewVariantProps} from "./types"

const PlaygroundCreateNewVariant: React.FC<PlaygroundCreateNewVariantProps> = ({
    className,
    displayedVariants,
    onSelect,
    selectedVariant,
    buttonProps,
    ...popoverProps
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const triggers = useMemo(() => {
        return (isModalOpen ? ["click", "hover"] : ["click"]) as PopoverProps["trigger"]
    }, [isModalOpen])

    return (
        <Popover
            {...popoverProps}
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            trigger={triggers}
            arrow={false}
            content={
                <CreateNewVariantList
                    displayedVariants={displayedVariants}
                    onSelect={onSelect}
                    selectedVariant={selectedVariant}
                    closeModal={() => setIsModalOpen(false)}
                />
            }
            className={className}
        >
            <AddButton {...buttonProps} />
        </Popover>
    )
}

export default PlaygroundCreateNewVariant
