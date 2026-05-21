import {TestcaseDataEditor, type TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"

interface EvalDrawerDataSectionProps {
    title: string
    value: Record<string, unknown>
    columns: TestcaseDataEditorColumn[]
}

const EvalDrawerDataSection = ({title, value, columns}: EvalDrawerDataSectionProps) => {
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
                    rootViewMode: true,
                    columnMapping: false,
                }}
            />
        </div>
    )
}

export default EvalDrawerDataSection
