import React, {useState} from "react"
import AddButton from "../../../assets/AddButton"
import {PlaygroundCreateNewVariantProps} from "./types"
import CreateNewVariantList from "./assets/CreateNewVariantList"
import {Popover} from "antd"

const PlaygroundCreateNewVariant: React.FC<PlaygroundCreateNewVariantProps> = ({
    className,
    displayedVariants,
    onSelect,
    selectedVariant,
    buttonProps,
    ...popoverProps
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false)

    return (
        <Popover
            {...popoverProps}
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            trigger={["click"]}
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
