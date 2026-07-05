import type {MouseEvent, ReactNode} from "react"
import {useMemo, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {GearSix} from "@phosphor-icons/react"
import {Checkbox, Tooltip} from "antd"

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
            const label = node.titleNode ?? node.label ?? node.key
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
            <div className="border-t border-zinc-2 my-1" />
            <div className="flex justify-between gap-2">
                <Button onClick={() => controls.reset()} variant="outline" size="sm">
                    Reset
                </Button>
                <Button onClick={onClose} size="sm">
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
        setOpen((current) => !current)
    }

    const trigger =
        variant === "icon" ? (
            <Tooltip title={label}>
                <PopoverTrigger
                    render={
                        <Button
                            onClick={stopPropagation}
                            variant="ghost"
                            size="icon-sm"
                            className="rounded-full"
                        >
                            {<GearSix size={16} weight="bold" />}
                        </Button>
                    }
                />
            </Tooltip>
        ) : (
            <PopoverTrigger
                render={
                    <Button onClick={stopPropagation} variant="outline">
                        {<GearSix size={14} weight="bold" />}
                        {label} ({visibleLeafCount})
                    </Button>
                }
            />
        )

    const content = renderContent ? (
        renderContent(controls, () => setOpen(false))
    ) : (
        <DefaultVisibilityContent controls={controls} onClose={() => setOpen(false)} />
    )

    return (
        <Popover
            open={open}
            onOpenChange={(value, eventDetails) => {
                if (eventDetails.reason !== "trigger-press") setOpen(value)
            }}
        >
            {trigger}
            <PopoverContent side="bottom" align="end" className="w-auto min-w-[220px]">
                {content}
            </PopoverContent>
        </Popover>
    )
}

export default ColumnVisibilityTrigger
