import {useMemo} from "react"

import {useRowHeight} from "@/oss/components/InfiniteVirtualTable"
import {TestcasesTableShell} from "@/oss/components/TestcasesTableNew/components/TestcasesTableShell"
import {useTestcasesTable} from "@/oss/components/TestcasesTableNew/hooks/useTestcasesTable"
import {
    testcaseRowHeightAtom,
    TESTCASE_ROW_HEIGHT_CONFIG,
} from "@/oss/components/TestcasesTableNew/state/rowHeight"

import {PREVIEW_ROW_LIMIT} from "../assets/constants"

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
    const previewRows = useMemo(
        () => previewTable.rowRefs.filter((row) => row.__isNew).slice(0, PREVIEW_ROW_LIMIT),
        [previewTable.rowRefs],
    )

    const title = testcaseCount > 1 ? "4. Preview Testcases" : "4. Preview Testcase"

    return (
        <div className="flex flex-col gap-1">
            <span className="font-medium">{title}</span>
            <span className="text-xs text-muted-foreground">
                See how your mapped data will appear in the testset
            </span>
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
                            maxRows={PREVIEW_ROW_LIMIT}
                            dataSource={previewRows}
                        />
                    ) : (
                        <div className="py-4 px-3 bg-gray-50 rounded-md border border-dashed border-gray-200 text-center">
                            <span className="text-muted-foreground">
                                Select a testset and configure mappings to see the preview
                            </span>
                        </div>
                    )}
                </div>
            ) : (
                <div className="py-4 px-3 bg-gray-50 rounded-md border border-dashed border-gray-200 text-center">
                    <span className="text-muted-foreground">
                        Add at least one mapping to see how your data will appear
                    </span>
                </div>
            )}
        </div>
    )
}
