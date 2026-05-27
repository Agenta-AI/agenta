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
}

const EvalDrawerDataSection = ({
    title,
    value,
    columns,
    rootViewMode = "form",
    collapseSignal = 0,
}: EvalDrawerDataSectionProps) => {
    if (!columns.length) return null

    return (
        <div className="flex flex-col border-t border-solid border-[#0517290F]">
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
