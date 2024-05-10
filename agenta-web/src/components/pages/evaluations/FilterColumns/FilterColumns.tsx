import {JSSTheme} from "@/lib/Types"
import {CheckOutlined, DownOutlined} from "@ant-design/icons"
import {Button, Dropdown, Space, theme} from "antd"
import {ItemType} from "antd/es/menu/hooks/useItems"
import React from "react"
import {createUseStyles} from "react-jss"
import {ColDef} from "ag-grid-community"

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
    setIsOpen: (value: React.SetStateAction<boolean>) => void
    handleOpenChange: (
        open: boolean,
        info: {
            source: "trigger" | "menu"
        },
    ) => void
    shownCols: string[]
    handleToggleVisibility: (evalConfigId: string) => void
    items: ItemType[]
}

const FilterColumns = ({
    isOpen,
    handleOpenChange,
    shownCols,
    setIsOpen,
    handleToggleVisibility,
    items,
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
                onClick: ({key}) => {
                    handleToggleVisibility(key)
                    setIsOpen(true)
                },
                className: classes.dropdownMenu,
            }}
        >
            <Button>
                Filter Columns <DownOutlined />
            </Button>
        </Dropdown>
    )
}

export default FilterColumns
