import {memo} from "react"

import {Input} from "antd"

import useFocusInput from "@/oss/hooks/useFocusInput"

import NewVariantButton from "../../../../Modals/CreateVariantModal/assets/NewVariantButton"

const TreeSelectItemRenderer = ({
    isOpen,
    close,
    menu,
}: {
    isOpen: boolean
    menu: any
    close: () => void
}) => {
    const {inputRef} = useFocusInput({isOpen})
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <Input
                    ref={inputRef}
                    placeholder="Search"
                    variant="borderless"
                    className="border-0 border-b border-solid border-[#f0f0f0] rounded-none py-2"
                />
                <NewVariantButton
                    className="flex justify-start [&_.ant-btn-icon]:!hidden self-center grow-0"
                    variant="solid"
                    type="primary"
                    onClick={close}
                    label="Create new"
                />
            </div>
            {menu}
        </div>
    )
}

export default memo(TreeSelectItemRenderer)
