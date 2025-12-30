import {useCallback, useEffect, useState} from "react"

import {WarningCircle} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useSetAtom} from "jotai"

import GenericDrawer from "@/oss/components/GenericDrawer"
import useResizeObserver from "@/oss/hooks/useResizeObserver"

import {TestsetTraceData} from "./assets/types"
import {initializeTraceDataAtom, isDrawerOpenAtom} from "./atoms/drawerState"
import {
    ConfirmSaveModal,
    DataPreviewEditor,
    MappingSection,
    PreviewSection,
    TestsetSelector,
} from "./components"
import {useTestsetDrawer} from "./hooks"

interface TestsetDrawerProps {
    open: boolean
    data?: TestsetTraceData[]
    showSelectedSpanText?: boolean
    onClose: () => void
    /** Initial path to start navigation at in drill-in view (e.g., "inputs.prompt" or ["inputs", "prompt"]) */
    initialPath?: string | string[]
}

const TestsetDrawer = ({open, data, onClose, initialPath = "ag.data"}: TestsetDrawerProps) => {
    const setIsDrawerOpen = useSetAtom(isDrawerOpenAtom)
    const initializeTraceData = useSetAtom(initializeTraceDataAtom)
    const drawer = useTestsetDrawer()

    // State for focusing drill-in view on a specific path
    const [focusPath, setFocusPath] = useState<string | undefined>(undefined)

    // Handler to focus drill-in on a path from mapping section or property click
    const handleFocusPath = useCallback((path: string) => {
        setFocusPath(path)
    }, [])

    // Handler when focus has been handled
    const handleFocusPathHandled = useCallback(() => {
        setFocusPath(undefined)
    }, [])

    // Sync props to atoms
    useEffect(() => {
        setIsDrawerOpen(open)
    }, [open, setIsDrawerOpen])

    useEffect(() => {
        if (data && data.length > 0) {
            initializeTraceData(data)
        }
    }, [data, initializeTraceData])

    const elemRef = useResizeObserver<HTMLDivElement>((rect) => {
        drawer.setIsDrawerExtended(rect.width > 640)
    })

    const elementWidth = drawer.isDrawerExtended ? 200 * 2 : 200

    return (
        <>
            <GenericDrawer
                open={open}
                destroyOnHidden={false}
                onClose={() => {
                    drawer.handleDrawerClose()
                    onClose()
                }}
                expandable
                initialWidth={640}
                headerExtra="Add to testset"
                footer={
                    <div className="flex justify-end items-center gap-2 py-2 px-3">
                        <Button
                            onClick={() => {
                                drawer.handleDrawerClose()
                                onClose()
                            }}
                        >
                            Cancel
                        </Button>
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
                            focusPath={focusPath}
                            onFocusPathHandled={handleFocusPathHandled}
                            onPropertyClick={handleFocusPath}
                            initialPath={initialPath}
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
                            onFocusPath={handleFocusPath}
                        />

                        <PreviewSection
                            selectedRevisionId={drawer.selectedRevisionId}
                            isMapColumnExist={drawer.isMapColumnExist}
                            isNewTestset={drawer.isNewTestset}
                            testcaseCount={drawer.traceData.length}
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
