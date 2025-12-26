import {WarningCircle} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtomValue} from "jotai"

import GenericDrawer from "@/oss/components/GenericDrawer"
import useResizeObserver from "@/oss/hooks/useResizeObserver"

import {isDrawerOpenAtom} from "./atoms/drawerState"
import {
    ConfirmSaveModal,
    DataPreviewEditor,
    MappingSection,
    PreviewSection,
    TestsetSelector,
} from "./components"
import {useTestsetDrawer} from "./hooks"

const TestsetDrawer = () => {
    const isOpen = useAtomValue(isDrawerOpenAtom)
    const drawer = useTestsetDrawer()

    const elemRef = useResizeObserver<HTMLDivElement>((rect) => {
        drawer.setIsDrawerExtended(rect.width > 640)
    })

    const elementWidth = drawer.isDrawerExtended ? 200 * 2 : 200

    return (
        <>
            <GenericDrawer
                open={isOpen}
                destroyOnHidden={false}
                onClose={drawer.handleDrawerClose}
                expandable
                initialWidth={640}
                headerExtra="Add to testset"
                footer={
                    <div className="flex justify-end items-center gap-2 py-2 px-3">
                        <Button onClick={drawer.handleDrawerClose}>Cancel</Button>
                        <Button
                            type="primary"
                            loading={drawer.isLoading || drawer.isTestsetsLoading}
                            onClick={() =>
                                !drawer.isNewTestset && drawer.isNewColumnCreated
                                    ? drawer.setIsConfirmSave(true)
                                    : drawer.onSaveTestset()
                            }
                            disabled={
                                !drawer.testset.name ||
                                !drawer.isMapColumnExist ||
                                drawer.hasDuplicateColumns
                            }
                        >
                            Save
                        </Button>
                    </div>
                }
                mainContent={
                    <section ref={elemRef} className="w-full flex flex-col gap-6">
                        {drawer.isDifferStructureExist && (
                            <Typography.Text
                                className="mb-1 flex items-center gap-1"
                                type="warning"
                            >
                                <WarningCircle size={16} /> Some of the selected spans have a
                                different structure than the others.
                            </Typography.Text>
                        )}

                        <TestsetSelector
                            cascaderValue={drawer.cascaderValue}
                            cascaderOptions={drawer.cascaderOptions}
                            onCascaderChange={drawer.onCascaderChange}
                            loadRevisions={drawer.loadRevisions}
                            isTestsetsLoading={drawer.isTestsetsLoading}
                            loadingRevisions={drawer.loadingRevisions}
                            renderSelectedRevisionLabel={drawer.renderSelectedRevisionLabel}
                            isNewTestset={drawer.isNewTestset}
                            newTestsetName={drawer.newTestsetName}
                            setNewTestsetName={drawer.setNewTestsetName}
                            elementWidth={elementWidth}
                        />

                        <DataPreviewEditor
                            traceData={drawer.traceData}
                            rowDataPreview={drawer.rowDataPreview}
                            setRowDataPreview={drawer.setRowDataPreview}
                            setUpdatedTraceData={drawer.setUpdatedTraceData}
                            editorFormat={drawer.editorFormat}
                            formatDataPreview={drawer.formatDataPreview}
                            selectedTraceData={drawer.selectedTraceData}
                            onRemoveTraceData={drawer.onRemoveTraceData}
                            onSaveEditedTrace={drawer.onSaveEditedTrace}
                            onRevertEditedTrace={drawer.onRevertEditedTrace}
                            columnOptions={drawer.columnOptions}
                            onMapToColumn={drawer.onMapToColumnFromDrillIn}
                            onUnmap={drawer.onUnmapFromDrillIn}
                            mappedPaths={drawer.mappedPaths}
                        />

                        <MappingSection
                            mappingData={drawer.mappingData}
                            setMappingData={drawer.setMappingData}
                            onMappingOptionChange={drawer.onMappingOptionChange}
                            onNewColumnBlur={drawer.onNewColumnBlur}
                            allAvailablePaths={drawer.allAvailablePaths}
                            columnOptions={drawer.columnOptions}
                            customSelectOptions={drawer.customSelectOptions}
                            selectedRevisionId={drawer.selectedRevisionId}
                            hasDuplicateColumns={drawer.hasDuplicateColumns}
                            testsetId={drawer.testset.id}
                            selectedTestsetColumns={drawer.selectedTestsetColumns}
                            elementWidth={elementWidth}
                            isNewTestset={drawer.isNewTestset}
                        />

                        <PreviewSection
                            selectedRevisionId={drawer.selectedRevisionId}
                            isMapColumnExist={drawer.isMapColumnExist}
                            isNewTestset={drawer.isNewTestset}
                        />

                        <ConfirmSaveModal
                            isConfirmSave={drawer.isConfirmSave}
                            setIsConfirmSave={drawer.setIsConfirmSave}
                            onSaveTestset={drawer.onSaveTestset}
                            isLoading={drawer.isLoading}
                            isTestsetsLoading={drawer.isTestsetsLoading}
                            testsetName={drawer.testset.name}
                            selectedTestsetColumns={drawer.selectedTestsetColumns}
                            isNewTestset={drawer.isNewTestset}
                            commitMessage={drawer.commitMessage}
                            setCommitMessage={drawer.setCommitMessage}
                            availableRevisions={drawer.availableRevisions}
                        />
                    </section>
                }
            />
        </>
    )
}

export default TestsetDrawer
