import {Typography} from "antd"

import {useRowHeight} from "@/oss/components/InfiniteVirtualTable"
import {TestcasesTableShell} from "@/oss/components/TestcasesTableNew/components/TestcasesTableShell"
import {useTestcasesTable} from "@/oss/components/TestcasesTableNew/hooks/useTestcasesTable"
import {
    testcaseRowHeightAtom,
    TESTCASE_ROW_HEIGHT_CONFIG,
} from "@/oss/components/TestcasesTableNew/state/rowHeight"

import {useStyles} from "../assets/styles"

interface PreviewSectionProps {
    selectedRevisionId: string
    isMapColumnExist: boolean
    isNewTestset?: boolean
}

export function PreviewSection({
    selectedRevisionId,
    isMapColumnExist,
    isNewTestset = false,
}: PreviewSectionProps) {
    const classes = useStyles()

    const previewTable = useTestcasesTable({
        revisionId: isNewTestset ? "draft" : selectedRevisionId || undefined,
        skipEmptyRevisionInit: true,
    })
    const rowHeight = useRowHeight(testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG)

    return (
        <div className={classes.container}>
            <Typography.Text className={classes.label}>Preview</Typography.Text>
            {isMapColumnExist ? (
                <div>
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
                            autoHeight={true}
                            disableDeleteAction={true}
                            scopeIdPrefix="drawer-preview"
                        />
                    ) : (
                        <Typography.Text type="secondary">
                            Select a testset and configure mappings to preview
                        </Typography.Text>
                    )}
                </div>
            ) : (
                <Typography.Text>Please select testset to view testset preview.</Typography.Text>
            )}
        </div>
    )
}
