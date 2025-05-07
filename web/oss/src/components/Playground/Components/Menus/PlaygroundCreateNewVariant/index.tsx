import {useState} from "react"

import {ArrowsLeftRight} from "@phosphor-icons/react"
import {Popover} from "antd"

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
            <AddButton icon={<ArrowsLeftRight size={14} />} {...buttonProps} />
        </Popover>
    )
}

export default PlaygroundCreateNewVariant
