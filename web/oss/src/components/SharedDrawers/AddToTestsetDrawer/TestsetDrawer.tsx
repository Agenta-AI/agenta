import {useCallback, useEffect, useRef, useState} from "react"

import {WarningCircle} from "@phosphor-icons/react"
import {Button, Input, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import GenericDrawer from "@/oss/components/GenericDrawer"
import useResizeObserver from "@/oss/hooks/useResizeObserver"

import {effectiveTestsetNameAtom} from "./atoms/cascaderState"
import {initializeWithSpanIdsAtom, isDrawerOpenAtom} from "./atoms/drawerState"
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
    /** Span IDs to load - entity atoms will fetch the actual data */
    spanIds?: string[]
    showSelectedSpanText?: boolean
    onClose: () => void
    /** Initial path to start navigation at in drill-in view (e.g., "inputs.prompt" or ["inputs", "prompt"]) */
    initialPath?: string | string[]
}

const TestsetDrawer = ({open, spanIds, onClose, initialPath = "ag.data"}: TestsetDrawerProps) => {
    const setIsDrawerOpen = useSetAtom(isDrawerOpenAtom)
    const initializeWithSpanIds = useSetAtom(initializeWithSpanIdsAtom)
    const drawer = useTestsetDrawer()
    const effectiveTestsetName = useAtomValue(effectiveTestsetNameAtom)

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

    // Initialize with span IDs - entity atoms will fetch the actual data
    useEffect(() => {
        if (spanIds && spanIds.length > 0) {
            initializeWithSpanIds(spanIds)
        }
    }, [spanIds, initializeWithSpanIds])

    // Track if trace data has loaded to trigger entity sync
    // When trace data entities finish loading (have non-empty data), sync local entities
    const hasTraceDataLoaded = useRef(false)
    useEffect(() => {
        // Check if trace data has actually loaded (has non-empty data objects)
        const hasData = drawer.traceData.some((t) => t.data && Object.keys(t.data).length > 0)

        // If we haven't synced yet AND data has now loaded AND we have a revision selected
        if (!hasTraceDataLoaded.current && hasData && drawer.selectedRevisionId) {
            hasTraceDataLoaded.current = true
            // Trigger entity sync by calling onNewColumnBlur which updates local entities
            // with the now-loaded trace data
            console.log("[TestsetDrawer] Trace data loaded, syncing local entities")
            drawer.onNewColumnBlur()
        }

        // Reset the flag when drawer closes
        if (!open) {
            hasTraceDataLoaded.current = false
        }
    }, [drawer.traceData, drawer.selectedRevisionId, drawer.onNewColumnBlur, open])

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
                closeButtonProps={{"data-tour": "add-to-testset-close"}}
                footer={
                    <div className="flex flex-col gap-3 py-2 px-3">
                        {/* Commit message input */}
                        <div className="flex flex-col gap-1">
                            <Typography.Text className="text-gray-500">
                                Commit message (optional)
                            </Typography.Text>
                            <Input.TextArea
                                placeholder="Describe your changes..."
                                value={drawer.commitMessage}
                                onChange={(e) => drawer.setCommitMessage(e.target.value)}
                                rows={2}
                                maxLength={500}
                            />
                        </div>
                        <div className="flex justify-end items-center gap-2">
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
                                        : drawer.onSaveTestset(onClose)
                                }
                                disabled={
                                    !effectiveTestsetName ||
                                    !drawer.isMapColumnExist ||
                                    drawer.hasDuplicateColumns
                                }
                                data-tour="testset-confirm"
                            >
                                {drawer.isNewTestset ? "Create" : "Commit"}
                            </Button>
                        </div>
                    </div>
                }
                mainContent={
                    <section
                        ref={elemRef}
                        className="w-full flex flex-col gap-6"
                        data-tour="add-to-testset-drawer"
                    >
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
                            onRemoveMapping={drawer.onRemoveMapping}
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
                            onClose={onClose}
                            isLoading={drawer.isLoading}
                            isTestsetsLoading={drawer.isTestsetsLoading}
                            testsetName={drawer.testset.name}
                            selectedTestsetColumns={drawer.selectedTestsetColumns}
                        />
                    </section>
                }
            />
        </>
    )
}

export default TestsetDrawer
