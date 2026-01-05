import {Typography} from "antd"

import {useRowHeight} from "@/oss/components/InfiniteVirtualTable"
import {TestcasesTableShell} from "@/oss/components/TestcasesTableNew/components/TestcasesTableShell"
import {useTestcasesTable} from "@/oss/components/TestcasesTableNew/hooks/useTestcasesTable"
import {
    testcaseRowHeightAtom,
    TESTCASE_ROW_HEIGHT_CONFIG,
} from "@/oss/components/TestcasesTableNew/state/rowHeight"

interface PreviewSectionProps {
    selectedRevisionId: string
    isMapColumnExist: boolean
    isNewTestset?: boolean
    /** Number of testcases being added (for pluralization) */
    testcaseCount?: number
}

export function PreviewSection({
    selectedRevisionId,
    isMapColumnExist,
    isNewTestset = false,
    testcaseCount = 1,
}: PreviewSectionProps) {
    const previewTable = useTestcasesTable({
        revisionId: isNewTestset ? "draft" : selectedRevisionId || undefined,
        skipEmptyRevisionInit: true,
    })
    const rowHeight = useRowHeight(testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG)

    const title = testcaseCount > 1 ? "4. Preview Testcases" : "4. Preview Testcase"

    return (
        <div className="flex flex-col gap-1">
            <Typography.Text className="font-medium">{title}</Typography.Text>
            <Typography.Text type="secondary" className="text-xs">
                See how your mapped data will appear in the testset
            </Typography.Text>
            {isMapColumnExist ? (
                <div className="mt-1">
                    {(selectedRevisionId && selectedRevisionId !== "draft") || isNewTestset ? (
                        <TestcasesTableShell
                            mode="view"
                            revisionIdParam={isNewTestset ? "draft" : selectedRevisionId}
                            table={previewTable}
                            rowHeight={rowHeight}
                            selectedRowKeys={[]}
                            onSelectedRowKeysChange={() => {}}
                            onRowClick={() => {}}
                            onDeleteSelected={() => {}}
                            searchTerm=""
                            onSearchChange={() => {}}
                            header={null}
                            actions={null}
                            hideControls={true}
                            enableSelection={true}
                            showRowIndex={true}
                            autoHeight={false}
                            disableDeleteAction={true}
                            scopeIdPrefix="drawer-preview"
                            maxRows={5}
                        />
                    ) : (
                        <div className="py-4 px-3 bg-gray-50 rounded-md border border-dashed border-gray-200 text-center">
                            <Typography.Text type="secondary">
                                Select a testset and configure mappings to see the preview
                            </Typography.Text>
                        </div>
                    )}
                </div>
            ) : (
                <div className="py-4 px-3 bg-gray-50 rounded-md border border-dashed border-gray-200 text-center">
                    <Typography.Text type="secondary">
                        Add at least one mapping to see how your data will appear
                    </Typography.Text>
                </div>
            )}
        </div>
    )
}
