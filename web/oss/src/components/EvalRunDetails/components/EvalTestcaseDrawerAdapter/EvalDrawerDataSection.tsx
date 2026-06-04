import type {ReactNode} from "react"

import {
    TestcaseDataEditor,
    type RootDrawerViewMode,
    type TestcaseDataEditorColumn,
} from "@agenta/entity-ui/testcase"

interface EvalDrawerDataSectionProps {
    title: string
    value: Record<string, unknown>
    columns: TestcaseDataEditorColumn[]
    rootViewMode?: RootDrawerViewMode
    collapseSignal?: number
    /**
     * Optional right-aligned content rendered on a thin meta banner above
     * the section body. The banner is anchored on the left by the section
     * title in a small-caps style so the extra never floats orphaned.
     */
    headerExtra?: ReactNode
}

const EvalDrawerDataSection = ({
    title,
    value,
    columns,
    rootViewMode = "form",
    collapseSignal = 0,
    headerExtra,
}: EvalDrawerDataSectionProps) => {
    if (!columns.length) return null

    return (
        <div className="flex flex-col border-t border-solid border-[var(--ag-c-0517290F)]">
            {headerExtra ? (
                <div className="flex items-center justify-between gap-2 px-4 py-1.5">
                    <span className="text-xs font-medium uppercase tracking-wider text-[var(--ag-c-98A2B3)]">
                        {title}
                    </span>
                    <div className="flex items-center gap-2">{headerExtra}</div>
                </div>
            ) : null}
            <TestcaseDataEditor
                value={value}
                columns={columns}
                mode="view"
                surface="drawer"
                label={title}
                features={{
                    typeChips: true,
                    rootViewMode: false,
                    columnMapping: false,
                }}
                rootViewMode={rootViewMode}
                collapseSignal={collapseSignal}
            />
        </div>
    )
}

export default EvalDrawerDataSection
