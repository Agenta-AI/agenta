import type {ReactNode} from "react"

import {useColumnVisibilityContext} from "../../context/ColumnVisibilityContext"
import type {ColumnVisibilityState} from "../../types"
import ColumnVisibilityTrigger from "../ColumnVisibilityTrigger"

import ColumnVisibilityPopoverContent, {
    type ColumnVisibilityNodeMeta,
    type ColumnVisibilityPopoverContentProps,
} from "./ColumnVisibilityPopoverContent"

interface ColumnVisibilityMenuTriggerProps<RowType extends object>
    extends Omit<ColumnVisibilityPopoverContentProps<RowType>, "onClose"> {
    variant?: "icon" | "button"
    label?: string
    controls?: ColumnVisibilityState<RowType>
    renderContent?: (
        controls: ColumnVisibilityState<RowType>,
        close: () => void,
        context: {scopeId: string | null},
    ) => ReactNode
}

const ColumnVisibilityMenuTrigger = <RowType extends object>({
    variant = "button",
    label = "Columns",
    controls,
    renderContent,
    scopeId,
    resolveNodeMeta,
}: ColumnVisibilityMenuTriggerProps<RowType>) => {
    const {
        controls: fallbackControls,
        renderMenuContent: contextRenderContent,
        scopeId: contextScopeId,
    } = useColumnVisibilityContext<RowType>()
    const visibilityControls = controls ?? fallbackControls
    const effectiveScopeId = scopeId ?? contextScopeId ?? null

    const contentRenderer = renderContent ?? contextRenderContent

    return (
        <ColumnVisibilityTrigger
            controls={visibilityControls}
            variant={variant}
            label={label}
            renderContent={(ctrls, close) =>
                contentRenderer ? (
                    contentRenderer(ctrls, close, {scopeId: effectiveScopeId})
                ) : (
                    <ColumnVisibilityPopoverContent
                        onClose={close}
                        controls={ctrls}
                        scopeId={effectiveScopeId}
                        resolveNodeMeta={resolveNodeMeta}
                    />
                )
            }
        />
    )
}

export default ColumnVisibilityMenuTrigger

export type {ColumnVisibilityNodeMeta}
