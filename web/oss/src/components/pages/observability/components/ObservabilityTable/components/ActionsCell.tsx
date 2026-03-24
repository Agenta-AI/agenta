import {memo, useMemo} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {ArrowSquareOut, DatabaseIcon, TrashIcon} from "@phosphor-icons/react"
import {Button, Dropdown, type MenuProps, Tooltip} from "antd"

import type {ObservabilityTraceRow} from "@/oss/components/pages/observability/assets/getObservabilityColumns"

const CELL_CLASS =
    "flex h-full w-full min-w-0 items-center justify-center px-2 [&_.ant-btn]:h-8 [&_.ant-btn]:w-8"

interface ObservabilityActionsCellProps {
    record: ObservabilityTraceRow
    onOpenTrace: (record: ObservabilityTraceRow) => void
    onAddToTestset: (record: ObservabilityTraceRow) => void
    onDeleteTrace: (record: ObservabilityTraceRow) => void
}

const ObservabilityActionsCell = ({
    record,
    onOpenTrace,
    onAddToTestset,
    onDeleteTrace,
}: ObservabilityActionsCellProps) => {
    const items = useMemo<MenuProps["items"]>(
        () => [
            {
                key: "open-trace",
                label: "Open trace",
                icon: <ArrowSquareOut size={16} />,
                onClick: (event) => {
                    event.domEvent.stopPropagation()
                    onOpenTrace(record)
                },
            },
            {
                key: "add-to-testset",
                label: "Add to testset",
                icon: <DatabaseIcon size={16} />,
                onClick: (event) => {
                    event.domEvent.stopPropagation()
                    onAddToTestset(record)
                },
            },
            {type: "divider"},
            {
                key: "delete-trace",
                label: "Delete trace",
                icon: <TrashIcon size={16} />,
                danger: true,
                onClick: (event) => {
                    event.domEvent.stopPropagation()
                    onDeleteTrace(record)
                },
            },
        ],
        [onAddToTestset, onDeleteTrace, onOpenTrace, record],
    )

    return (
        <div className={CELL_CLASS}>
            <Dropdown trigger={["click"]} menu={{items}} styles={{root: {width: 200}}}>
                <Tooltip title="Actions">
                    <Button
                        type="text"
                        shape="circle"
                        icon={<MoreOutlined />}
                        onClick={(event) => event.stopPropagation()}
                    />
                </Tooltip>
            </Dropdown>
        </div>
    )
}

export default memo(ObservabilityActionsCell)
