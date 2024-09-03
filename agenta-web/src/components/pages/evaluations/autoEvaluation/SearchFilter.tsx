import {_Evaluation} from "@/lib/Types"
import {Input, InputRef, TableColumnType, DatePicker} from "antd"
import {FilterDropdownProps} from "antd/es/table/interface"
import React, {useRef} from "react"
import dayjs from "dayjs"

type DataIndex = keyof _Evaluation

type CellDataType = "number" | "text" | "date"

export function getFilterParams(
    dataIndex: DataIndex,
    type: CellDataType,
): TableColumnType<_Evaluation> {
    const searchInput = useRef<InputRef>(null)

    const filterDropdown = ({setSelectedKeys, selectedKeys, confirm}: FilterDropdownProps) => {
        return (
            <div className="p-2" onKeyDown={(e) => e.stopPropagation()}>
                {type === "date" ? (
                    <DatePicker
                        value={selectedKeys[0] ? dayjs(selectedKeys[0] as string) : null}
                        onChange={(_, dateString: any) => {
                            setSelectedKeys(dateString ? [dateString] : [])
                            confirm()
                        }}
                    />
                ) : (
                    <Input
                        ref={searchInput}
                        placeholder={`Search ${dataIndex}`}
                        value={selectedKeys[0]}
                        onChange={(e) => {
                            setSelectedKeys(e.target.value ? [e.target.value] : [])
                            confirm({closeDropdown: false})
                        }}
                        style={{display: "block"}}
                        type={type}
                    />
                )}
            </div>
        )
    }

    const onFilter = (value: any, record: any) => {
        try {
            const cellValue = record[dataIndex]

            if (type === "date") {
                return dayjs(cellValue).isSame(dayjs(value), "day")
            }
            if (typeof cellValue === "object" && cellValue !== null) {
                if (Array.isArray(cellValue)) {
                    return cellValue.some((item) =>
                        item.variantName?.toLowerCase().includes(value.toLowerCase()),
                    )
                } else if (cellValue.hasOwnProperty("name")) {
                    return cellValue.name.toString().toLowerCase().includes(value.toLowerCase())
                } else if (cellValue.hasOwnProperty("value")) {
                    return cellValue.value.toString().toLowerCase().includes(value.toLowerCase())
                }
            }
            return cellValue?.toString().toLowerCase().includes(value.toLowerCase())
        } catch (error) {
            console.error(error)
        }
    }

    return {
        filterDropdown,
        onFilter,
        onFilterDropdownOpenChange: (visible) => {
            if (visible) {
                setTimeout(() => searchInput.current?.select(), 100)
            }
        },
    }
}
