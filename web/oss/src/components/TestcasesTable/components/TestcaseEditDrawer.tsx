import {useCallback, useMemo, useRef, useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Button, Segmented, Tag} from "antd"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import type {EditableTableColumn} from "@/oss/components/InfiniteVirtualTable/hooks/useEditableTable"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"

import TestcaseEditDrawerContent, {
    type TestcaseEditDrawerContentRef,
} from "./TestcaseEditDrawerContent"

type EditMode = "fields" | "json"

interface TestcaseEditDrawerProps {
    open: boolean
    onClose: () => void
    row: Record<string, unknown> | null
    columns: EditableTableColumn[]
    isNewRow: boolean
    onSave: (rowKey: string, updates: Record<string, unknown>) => void
    afterOpenChange?: (open: boolean) => void
}

const TestcaseEditDrawer = ({
    open,
    onClose,
    row,
    columns,
    isNewRow,
    onSave,
    afterOpenChange,
}: TestcaseEditDrawerProps) => {
    const [editMode, setEditMode] = useState<EditMode>("fields")
    const [hasChanges, setHasChanges] = useState(false)
    const contentRef = useRef<TestcaseEditDrawerContentRef>(null)

    const rowId = row?.id as string | undefined

    const handleSave = useCallback(() => {
        contentRef.current?.handleSave()
    }, [])

    const title = useMemo(() => {
        const titleText = isNewRow ? "New Testcase" : "Edit Testcase"
        const idTag = rowId ? (
            <TooltipWithCopyAction title="Click to copy ID" copyText={rowId}>
                <Tag
                    bordered
                    className="!border-[#D0D5DD] !bg-[#F9FAFB] !text-[#344054] cursor-copy rounded-full px-2 py-0.5 text-xs font-medium"
                >
                    {rowId.slice(-8)}
                </Tag>
            </TooltipWithCopyAction>
        ) : null

        return (
            <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                    <Button type="text" icon={<CloseOutlined />} onClick={onClose} />
                    <span>{titleText}</span>
                    {idTag}
                </div>
                <Segmented
                    size="small"
                    value={editMode}
                    onChange={(value) => setEditMode(value as EditMode)}
                    options={[
                        {label: "Fields", value: "fields"},
                        {label: "JSON", value: "json"},
                    ]}
                />
            </div>
        )
    }, [isNewRow, rowId, editMode, onClose])

    return (
        <EnhancedDrawer
            title={title}
            open={open}
            onClose={onClose}
            width={600}
            closeIcon={null}
            closeOnLayoutClick={false}
            afterOpenChange={afterOpenChange}
            destroyOnHidden
            styles={{body: {padding: "16px 24px"}, footer: {padding: "12px 24px"}}}
            footer={
                <div className="w-full flex items-center justify-end gap-3">
                    <Button onClick={onClose}>Cancel</Button>
                    <Button type="primary" onClick={handleSave} disabled={!hasChanges}>
                        {isNewRow ? "Create" : "Save Changes"}
                    </Button>
                </div>
            }
        >
            {open && row && (
                <TestcaseEditDrawerContent
                    ref={contentRef}
                    row={row}
                    columns={columns}
                    isNewRow={isNewRow}
                    onSave={onSave}
                    onClose={onClose}
                    editMode={editMode}
                    onHasChangesChange={setHasChanges}
                />
            )}
        </EnhancedDrawer>
    )
}

export default TestcaseEditDrawer
