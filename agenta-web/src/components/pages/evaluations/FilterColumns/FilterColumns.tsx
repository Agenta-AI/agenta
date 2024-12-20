import {JSSTheme} from "@/lib/Types"
import {CheckOutlined, DownOutlined} from "@ant-design/icons"
import {Button, Dropdown, Space} from "antd"
import {ItemType} from "antd/es/menu/interface"
import React from "react"
import {createUseStyles} from "react-jss"
import {type ColDef} from "@ag-grid-community/core"

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
}))

export const generateFilterItems = (colDefs: ColDef[]) => {
    return colDefs.map((configs) => ({
        key: configs.headerName as string,
        label: (
            <Space>
                <CheckOutlined />
                <>{configs.headerName}</>
            </Space>
        ),
    }))
}

interface FilterColumnsProps {
    isOpen: boolean
    handleOpenChange: (
        open: boolean,
        info: {
            source: "trigger" | "menu"
        },
    ) => void
    shownCols: string[]
    items: ItemType[]
    onClick: ({key}: {key: string}) => void
    buttonText?: string
}

const FilterColumns = ({
    isOpen,
    handleOpenChange,
    shownCols,
    items,
    onClick,
    buttonText,
}: FilterColumnsProps) => {
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
            <Button>
                {!buttonText ? (
                    <>
                        Filter Columns <DownOutlined />
                    </>
                ) : (
                    buttonText
                )}
            </Button>
        </Dropdown>
    )
}

export default FilterColumns
