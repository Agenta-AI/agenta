import {useMemo} from "react"
import {Button, Dropdown, MenuProps} from "antd"
import {CaretUpDown} from "@phosphor-icons/react"
import clsx from "clsx"

interface SimpleDropdownSelectProps {
    value: string
    options: Array<{
        label: string
        value: string
        group?: string
    }>
    onChange: (value: string) => void
    placeholder?: string
    className?: string
}

const SimpleDropdownSelect = ({value, options, onChange, placeholder = "Select...", className}: SimpleDropdownSelectProps) => {
    const menuItems= useMemo(() => {
        return options.map(item => ({
            key: item.value,
            label: item.label,
            onClick: () => onChange(item.value),
            // type: item.group ? 'group' : undefined,
        }))
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
