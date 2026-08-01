import type {MouseEvent, ReactNode} from "react"
import {useMemo, useState} from "react"

import {GearSix} from "@phosphor-icons/react"
import {Checkbox, Popover, Tooltip} from "antd"

import {Button} from "../../components/ui/button"
import type {ColumnVisibilityState} from "../types"

type ColumnVisibilityControls<Row extends object> = ColumnVisibilityState<Row>

interface ColumnVisibilityTriggerProps<Row extends object> {
    controls: ColumnVisibilityControls<Row>
    variant?: "button" | "icon"
    label?: string
    renderContent?: (controls: ColumnVisibilityControls<Row>, close: () => void) => ReactNode
}

const DefaultVisibilityContent = <Row extends object>({
    controls,
    onClose,
}: {
    controls: ColumnVisibilityControls<Row>
    onClose: () => void
}) => {
    const nodes = useMemo(() => controls.columnTree, [controls.columnTree])

    const renderNodes = (tree: typeof nodes, depth = 0): ReactNode =>
        tree.map((node) => {
            // String(): React.Key carries an experimental symbol member, so it is NOT a ReactNode.
            const label = node.titleNode ?? node.label ?? String(node.key)
            const childNodes = node.children?.length ? renderNodes(node.children, depth + 1) : null
            const isGroup = Boolean(node.children?.length)
            return (
                <div key={node.key} className="flex flex-col gap-1">
                    <Checkbox
                        indeterminate={node.indeterminate}
                        checked={node.checked}
                        onChange={() =>
                            isGroup
                                ? controls.toggleTree(node.key)
                                : controls.toggleColumn(node.key)
                        }
                        style={{marginLeft: depth ? depth * 12 : 0}}
                    >
                        {label}
                    </Checkbox>
                    {childNodes}
                </div>
            )
        })

    return (
        <div className="flex flex-col gap-3 min-w-[220px]">
            <div className="text-xs text-zinc-6">Toggle columns</div>
            <div className="max-h-64 overflow-auto pr-1">{renderNodes(nodes)}</div>
            <div className="border-0 border-t border-solid border-zinc-2 my-1" />
            <div className="flex justify-between gap-2">
                <Button variant="outline" size="sm" onClick={() => controls.reset()}>
                    Reset
                </Button>
                <Button size="sm" variant="default" onClick={onClose}>
                    Close
                </Button>
            </div>
        </div>
    )
}

const ColumnVisibilityTrigger = <Row extends object>({
    controls,
    variant = "button",
    label = "Columns",
    renderContent,
}: ColumnVisibilityTriggerProps<Row>) => {
    const [open, setOpen] = useState(false)
    const {leafKeys, isHidden} = controls

    const visibleLeafCount = useMemo(
        () => leafKeys.filter((key) => !isHidden(key)).length,
        [leafKeys, isHidden],
    )

    const stopPropagation = (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
    }

    const triggerNode =
        variant === "icon" ? (
            <Tooltip title={label}>
                <Button
                    className="rounded-control-round"
                    size="icon"
                    variant="ghost"
                    onClick={stopPropagation}
                >
                    {<GearSix size={16} weight="bold" />}
                </Button>
            </Tooltip>
        ) : (
            <Button variant="outline" onClick={stopPropagation}>
                {<GearSix size={14} weight="bold" />}
                {label} ({visibleLeafCount})
            </Button>
        )

    const content = renderContent ? (
        renderContent(controls, () => setOpen(false))
    ) : (
        <DefaultVisibilityContent controls={controls} onClose={() => setOpen(false)} />
    )

    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            destroyOnHidden
            open={open}
            onOpenChange={(value) => setOpen(value)}
            content={content}
        >
            {triggerNode}
        </Popover>
    )
}

export default ColumnVisibilityTrigger
