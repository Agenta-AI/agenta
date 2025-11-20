import {useMemo} from "react"

import {Input, Select, Typography} from "antd"

import {SaveDataModalContentProps} from "./types"
import useFocusInput from "@/oss/hooks/useFocusInput"
import EnhancedTable from "@/oss/components/EnhancedUIs/Table"

const SaveDataModalContent = ({
    rows,
    rowKeys,
    exportDataset,
    name,
    setName,
    isOpen,
    selectedColumns,
    setSelectedColumns,
}: SaveDataModalContentProps) => {
    const {inputRef} = useFocusInput({isOpen})

    const columns = useMemo(() => {
        if (selectedColumns.length === 0) {
            return [{title: "-", dataIndex: "-"}]
        }
        return selectedColumns.map((key) => ({
            title: key,
            dataIndex: key,
            width: 150,
            ellipsis: true,
        }))
    }, [selectedColumns])

    const options = useMemo(() => {
        return rowKeys.map((key) => ({label: key, value: key}))
    }, [rowKeys])

    return (
        <section className="flex flex-col gap-4 my-5">
            <div className="flex flex-col gap-1">
                <Typography.Text type="secondary">
                    {exportDataset ? "File name" : "Test set name"}
                </Typography.Text>
                <Input
                    ref={inputRef}
                    placeholder="Name"
                    onChange={(e) => setName(e.target.value)}
                    value={name}
                />
            </div>

            <div className="flex flex-col gap-1">
                <Typography.Text type="secondary">Columns</Typography.Text>
                <Select
                    mode="multiple"
                    allowClear
                    style={{width: "100%"}}
                    placeholder="Please select"
                    defaultValue={rowKeys}
                    value={selectedColumns}
                    onChange={setSelectedColumns}
                    options={options}
                />
            </div>

            <div className="flex flex-col gap-1">
                <Typography.Text type="secondary">Preview</Typography.Text>
                <EnhancedTable
                    dataSource={rows.slice(0, rows.length > 3 ? 3 : rows.length)}
                    columns={columns}
                    size="small"
                    bordered
                    pagination={false}
                    scroll={{x: "max-content"}}
                    virtualized
                />
            </div>
        </section>
    )
}

export default SaveDataModalContent
