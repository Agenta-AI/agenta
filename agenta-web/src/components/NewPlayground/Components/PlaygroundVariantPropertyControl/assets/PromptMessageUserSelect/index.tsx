import {useMemo} from "react"

import {Button, Dropdown, MenuProps} from "antd"
import {CaretUpDown} from "@phosphor-icons/react"
import clsx from "clsx"

import type {PromptMessageUserSelectProps} from "./types"

const PromptMessageUserSelect = ({
    disabled,
    value,
    options,
    onChange,
}: PromptMessageUserSelectProps) => {
    const menuItems: MenuProps["items"] = useMemo(() => {
        return options.map((option) => ({
            key: option,
            label: option,
            onClick: () => onChange(option),
        }))
    }, [options, onChange])

    return (
        <Dropdown disabled={disabled} menu={{items: menuItems}} trigger={["click"]}>
            <Button
                className={clsx([
                    "rounded-md",
                    "bg-white",
                    "mt-1 mx-2 px-2",
                    "border-0",
                    "flex items-center",
                ])}
            >
                {value || "Select..."} <CaretUpDown size={14} />
            </Button>
        </Dropdown>
    )
}

export default PromptMessageUserSelect
