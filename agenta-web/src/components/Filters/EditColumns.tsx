import React, {useState} from "react"
import {Button, Dropdown, Space, Checkbox} from "antd"
import {createUseStyles} from "react-jss"
import {Columns} from "@phosphor-icons/react"
import {ColumnsType} from "antd/es/table"
import type {MenuProps} from "antd"

const useStyles = createUseStyles((theme) => ({
    dropdownMenu: {
        "&>.ant-dropdown-menu-item": {
            "& .anticon-check": {
                display: "none",
            },
        },
        "&>.ant-dropdown-menu-item-selected": {
            "&:not(:hover)": {
                backgroundColor: "transparent !important",
            },
            "& .anticon-check": {
                display: "inline-flex !important",
            },
        },
    },
    button: {
        display: "flex",
        alignItems: "center",
    },
}))

interface EditColumnsProps {
    isOpen: boolean
    handleOpenChange: (open: boolean) => void
    selectedKeys: string[]
    columns: ColumnsType<any>
    onChange: (key: string) => void
    excludes?: string[] // Array of column keys to exclude
    buttonText?: string
}

const EditColumns: React.FC<EditColumnsProps> = ({
    isOpen,
    handleOpenChange,
    selectedKeys,
    columns,
    onChange,
    excludes = [],
    buttonText = "Edit Columns",
}) => {
    const classes = useStyles()
    const [open, setOpen] = useState(isOpen)

    const handleDropdownChange = (newOpen: boolean) => {
        setOpen(newOpen)
        if (!newOpen) handleOpenChange(newOpen)
    }

    const generateEditItems = (): MenuProps["items"] => {
        return columns
            .filter((col) => !excludes.includes(col.key as string))
            .flatMap((col) => [
                {
                    key: col.key as React.Key,
                    label: (
                        <Space onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                                value={col.key}
                                checked={!selectedKeys.includes(col.key as string)}
                                onChange={() => onChange(col.key as string)}
                            />
                            {col.title as string}
                        </Space>
                    ),
                },
                ...(("children" in col &&
                    col.children?.map((child) => ({
                        key: child.key as React.Key,
                        label: (
                            <Space className="ml-4" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                    value={child.key}
                                    checked={!selectedKeys.includes(child.key as string)}
                                    onChange={() => onChange(child.key as string)}
                                />
                                {child.title as string}
                            </Space>
                        ),
                    }))) ||
                    []),
            ])
    }

    return (
        <Dropdown
            trigger={["click"]}
            open={open}
            onOpenChange={handleDropdownChange}
            menu={{
                selectedKeys,
                items: generateEditItems(),
                className: classes.dropdownMenu,
            }}
        >
            <Button icon={<Columns size={14} />} className={classes.button}>
                {buttonText}
            </Button>
        </Dropdown>
    )
}

export default EditColumns
