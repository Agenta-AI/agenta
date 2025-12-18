import {useMemo} from "react"

import {CaretUpDown} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import clsx from "clsx"

import type {SimpleDropdownSelectProps, MenuItemType} from "./types"

const SimpleDropdownSelect = ({
    value,
    options,
    onChange,
    placeholder = "Select...",
    className,
    disabled,
}: SimpleDropdownSelectProps) => {
    const menuItems = useMemo(() => {
        return options.map((item) => ({
            ...item,
            className: "capitalize",
            onClick: () => onChange(item.value as string),
        })) as MenuItemType[]
    }, [options, onChange])

    return (
        <Dropdown
            disabled={disabled}
            menu={{items: menuItems}}
            trigger={["click"]}
            styles={{
                root: {
                    width: 150,
                },
            }}
        >
            <Button
                className={clsx(
                    "capitalize flex items-center px-[7px] hover:!bg-[rgba(5,23,41,0.15)]",
                    className,
                )}
                type="text"
            >
                {value || placeholder} <CaretUpDown size={14} />
            </Button>
        </Dropdown>
    )
}

export default SimpleDropdownSelect
