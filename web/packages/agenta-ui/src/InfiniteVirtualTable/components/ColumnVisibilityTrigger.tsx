import type {MouseEvent, ReactNode} from "react"
import {useMemo, useState} from "react"

import {GearSix} from "@phosphor-icons/react"

import {Button} from "../../components/ui/button"
import {Checkbox} from "../../components/ui/checkbox"
import {Popover, PopoverContent, PopoverTrigger} from "../../components/ui/popover"
import {SimpleTooltip} from "../../components/ui/tooltip-composed"
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
            const id = `column-visibility-${String(node.key)}`
            return (
                <div key={node.key} className="flex flex-col gap-1">
                    <label
                        htmlFor={id}
                        className="flex items-center gap-2 cursor-pointer text-field-md text-colorText"
                        style={{marginLeft: depth ? depth * 12 : 0}}
                    >
                        <Checkbox
                            id={id}
                            checked={node.indeterminate ? "indeterminate" : node.checked}
                            onCheckedChange={() =>
                                isGroup
                                    ? controls.toggleTree(node.key)
                                    : controls.toggleColumn(node.key)
                            }
                        />
                        {label}
                    </label>
                    {childNodes}
                </div>
            )
        })

    return (
        <div className="flex flex-col gap-3 min-w-[220px]">
            <div className="text-xs text-colorTextSecondary">Toggle columns</div>
            <div className="max-h-64 overflow-auto pr-1">{renderNodes(nodes)}</div>
            <div className="h-px bg-colorBorderSecondary my-1" />
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

    // Stop the click reaching the header cell (which sorts) but do NOT preventDefault: the
    // trigger's own open handler is composed onto this same element and is skipped once the
    // event is default-prevented. That is what left this control dead under antd.
    const stopPropagation = (event: MouseEvent) => event.stopPropagation()

    const triggerNode =
        variant === "icon" ? (
            <Button
                className="rounded-control-round"
                size="icon"
                variant="ghost"
                aria-label={label}
                onClick={stopPropagation}
            >
                <GearSix size={16} weight="bold" />
            </Button>
        ) : (
            <Button variant="outline" onClick={stopPropagation}>
                <GearSix size={14} weight="bold" />
                {label} ({visibleLeafCount})
            </Button>
        )

    return (
        <Popover open={open} onOpenChange={setOpen}>
            {/* Tooltip outside, popover trigger inside: each `asChild` clones down to the same
                button, so both sets of handlers compose onto it. */}
            <SimpleTooltip title={variant === "icon" ? label : undefined}>
                <PopoverTrigger asChild>{triggerNode}</PopoverTrigger>
            </SimpleTooltip>
            <PopoverContent align="end" className="w-auto p-3">
                {renderContent ? (
                    renderContent(controls, () => setOpen(false))
                ) : (
                    <DefaultVisibilityContent controls={controls} onClose={() => setOpen(false)} />
                )}
            </PopoverContent>
        </Popover>
    )
}

export default ColumnVisibilityTrigger
