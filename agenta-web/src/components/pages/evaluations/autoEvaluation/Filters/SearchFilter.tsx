import {_Evaluation, EvaluationStatus} from "@/lib/Types"
import {Input, TableColumnType, DatePicker} from "antd"
import {FilterDropdownProps} from "antd/es/table/interface"
import dayjs from "dayjs"
import {statusMapper} from "@/components/pages/evaluations/cellRenderers/cellRenderers"

type DataIndex = keyof _Evaluation

type CellDataType = "number" | "text" | "date"

export function getFilterParams(
    dataIndex: DataIndex,
    type: CellDataType,
): TableColumnType<_Evaluation> {
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
                        placeholder={`Search ${dataIndex}`}
                        value={selectedKeys[0]}
                        onChange={(e) => {
                            setSelectedKeys(e.target.value ? [e.target.value] : [])
                            confirm({closeDropdown: false})
                        }}
                        style={{display: "block"}}
                        step={0.1}
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
            if (dataIndex === "status") {
                const statusLabel = statusMapper({} as any)(record.status.value as EvaluationStatus)
                    .label as EvaluationStatus
                return statusLabel.toLowerCase().includes(value.toLowerCase())
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
    }
}
