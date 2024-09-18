import {_Evaluation, JSSTheme} from "@/lib/Types"
import {Button, Dropdown, Space, Checkbox} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"
import {Columns} from "@phosphor-icons/react"
import {ColumnsType} from "antd/es/table"

const useStyles = createUseStyles((theme: JSSTheme) => ({
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

export const generateEditItems = (columns: ColumnsType, editColumns: string[]) => {
    return columns
        .filter((col) => col.key !== "key")
        .flatMap((col) => [
            {
                key: col.key,
                label: (
                    <Space>
                        <Checkbox
                            value={col.key}
                            checked={editColumns.includes(col.key as string)}
                        />
                        {col.title as string}
                    </Space>
                ),
            },
            ...(("children" in col &&
                col.children?.map((child) => ({
                    key: child.key,
                    label: (
                        <Space className="ml-4">
                            <Checkbox
                                value={child.key}
                                checked={editColumns.includes(child.key as string)}
                            />
                            {child.key as string}
                        </Space>
                    ),
                }))) ||
                []),
        ])
}

interface EditColumnsProps {
    isOpen: boolean
    handleOpenChange: (
        open: boolean,
        info: {
            source: "trigger" | "menu"
        },
    ) => void
    shownCols: string[]
    items: any
    onClick: ({key}: {key: string}) => void
    buttonText?: string
}

const EditColumns = ({
    isOpen,
    handleOpenChange,
    shownCols,
    items,
    onClick,
    buttonText,
}: EditColumnsProps) => {
    const classes = useStyles()

    return (
        <Dropdown
            trigger={["click"]}
            open={isOpen}
            onOpenChange={handleOpenChange}
            menu={{
                selectedKeys: shownCols,
                items,
                onClick,
                className: classes.dropdownMenu,
            }}
        >
            <Button icon={<Columns size={14} />} className={classes.button}>
                Edit columns
            </Button>
        </Dropdown>
    )
}

export default EditColumns
