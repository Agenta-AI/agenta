import {useMemo} from "react"

import clsx from "clsx"
import {Button, Dropdown} from "antd"
import {CaretUpDown} from "@phosphor-icons/react"

import type { SimpleDropdownSelectProps, MenuItemType } from "./types"

const SimpleDropdownSelect = ({value, options, onChange, placeholder = "Select...", className}: SimpleDropdownSelectProps) => {
    const menuItems = useMemo(() => {
        return options.map(item => ({
            ...item,
            onClick: () => onChange(item.key as string),
        })) as MenuItemType[]
    }, [options, onChange])

    return (
        <Dropdown 
            menu={{items: menuItems}} 
            trigger={["click"]}
        >
            <Button className={clsx("rounded-md bg-white mt-1 mx-2 px-2 border-0 flex items-center", className)}>
                {value || placeholder} <CaretUpDown size={14} />
            </Button>
        </Dropdown>
    )
}

export default SimpleDropdownSelect
