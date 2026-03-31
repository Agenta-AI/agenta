import {memo} from "react"

import {Button, Input} from "antd"

import useFocusInput from "@/oss/hooks/useFocusInput"

import NewVariantButton from "../../../../Modals/CreateVariantModal/assets/NewVariantButton"
import {TreeSelectItemRendererProps} from "../../types"

const TreeSelectItemRenderer = ({
    isOpen,
    close,
    menu,
    showAsCompare,
    showCreateNew = true,
    searchTerm,
    setSearchTerm,
}: TreeSelectItemRendererProps) => {
    const {inputRef} = useFocusInput({isOpen})
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between border-0 border-b border-solid border-[#f0f0f0]">
                <Input
                    ref={inputRef}
                    placeholder="Search"
                    variant="borderless"
                    className="rounded-none py-2"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />

                <div className="flex items-center gap-1">
                    {searchTerm && (
                        <Button
                            type="link"
                            size="small"
                            onClick={() => setSearchTerm("")}
                            className="!text-[#758391]"
                        >
                            clear
                        </Button>
                    )}
                    {!showAsCompare && showCreateNew && (
                        <NewVariantButton
                            className="flex justify-start [&_.ant-btn-icon]:!hidden self-center grow-0 mr-0.5"
                            variant="solid"
                            type="primary"
                            onClick={close}
                            label="Create new"
                            size="small"
                        />
                    )}
                </div>
            </div>
            {menu}
        </div>
    )
}

export default memo(TreeSelectItemRenderer)
