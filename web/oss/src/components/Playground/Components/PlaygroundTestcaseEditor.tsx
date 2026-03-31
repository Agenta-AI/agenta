import {useCallback, useMemo, useRef, useState} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {executionItemController} from "@agenta/playground"
import {HeightCollapse, SyncStateTag, type SyncState} from "@agenta/ui"
import {RightOutlined} from "@ant-design/icons"
import {CaretRight, Code, TreeStructure} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {EntityDrillInView, JsonEditorWithLocalState} from "@/oss/components/DrillInView"
import type {DrillInExternalControls} from "@/oss/components/DrillInView"
import {AddPropertyForm} from "@/oss/components/DrillInView/AddPropertyForm"
import type {EntityAPI, EntityDrillIn, PathItem} from "@/oss/state/entities/shared"

// ============================================================================
// ADAPTER: wraps testcaseMolecule to conform to EntityAPI<Testcase>
// ============================================================================

type Testcase = NonNullable<ReturnType<typeof testcaseMolecule.get.data>>
interface Column {
    key: string
    label?: string
    name?: string
}

const testcaseEntityAdapter = {
    selectors: {
        data: testcaseMolecule.data,
        isDirty: testcaseMolecule.isDirty,
        serverData: testcaseMolecule.query,
        query: testcaseMolecule.query,
    },
    controller: testcaseMolecule.controller,
    actions: {
        update: testcaseMolecule.actions.update,
        discard: testcaseMolecule.actions.discard,
    },
    drillIn: {
        getValueAtPath: testcaseMolecule.drillIn.getValueAtPath,
        setValueAtPathAtom: atom(
            null,
            (_get, set, params: {id: string; path: string[]; value: unknown}) => {
                const changes = testcaseMolecule.drillIn.getChangesFromPath(
                    testcaseMolecule.get.data(params.id),
                    params.path,
                    params.value,
                )
                if (changes) {
                    set(testcaseMolecule.actions.update, params.id, changes)
                }
            },
        ),
        getRootItems: testcaseMolecule.drillIn.getRootItems as (
            entity: Testcase | null,
            ...args: unknown[]
        ) => PathItem[],
        valueMode: "native" as const,
    } satisfies EntityDrillIn<Testcase>,
} satisfies EntityAPI<Testcase, {data?: Record<string, unknown>}> & {
    drillIn: EntityDrillIn<Testcase>
}

// ============================================================================
// COMPONENT
// ============================================================================

type EditMode = "fields" | "json"

function PlaygroundTestcaseEditor({testcaseId}: {testcaseId: string}) {
    const [editMode, setEditMode] = useState<EditMode>("fields")
    const [isOpen, setIsOpen] = useState(true)

    // DrillIn controls state, synced from DrillInContent via renderExternalControls
    const controlsRef = useRef<DrillInExternalControls | null>(null)
    const [currentPath, setCurrentPath] = useState<string[]>([])
    const [currentPathDataType, setCurrentPathDataType] = useState<
        "array" | "object" | "root" | null
    >("root")

    const entityData = useAtomValue(useMemo(() => testcaseMolecule.data(testcaseId), [testcaseId]))
    const isDirty = useAtomValue(useMemo(() => testcaseMolecule.isDirty(testcaseId), [testcaseId]))

    const rawColumns = useAtomValue(testcaseMolecule.atoms.columns) as Column[] | null
    const schemaKeys = useAtomValue(executionItemController.selectors.variableKeys) as string[]
    const columns = useMemo(() => {
        const dataColumns = rawColumns?.filter((col) => col.key !== "testcase_dedup_id") ?? []
        if (dataColumns.length > 0) return dataColumns
        if (schemaKeys.length > 0) {
            return schemaKeys.map((key) => ({key, label: key}))
        }
        return null
    }, [rawColumns, schemaKeys])

    const jsonValue = useMemo(() => {
        if (!entityData?.data) return "{}"
        if (columns && columns.length > 0) {
            const filtered: Record<string, unknown> = {}
            for (const col of columns) {
                filtered[col.key] = entityData.data[col.key] ?? ""
            }
            return JSON.stringify(filtered, null, 2)
        }
        return JSON.stringify(entityData.data, null, 2)
    }, [entityData, columns])

    const updateTestcase = useSetAtom(testcaseMolecule.actions.update)

    const handleJsonChange = useCallback(
        (value: string) => {
            try {
                const parsed = JSON.parse(value)
                updateTestcase(testcaseId, {data: parsed})
            } catch {
                // Invalid JSON — ignore
            }
        },
        [updateTestcase, testcaseId],
    )

    // Callback from DrillInContent that syncs controls state
    const handleExternalControls = useCallback((controls: DrillInExternalControls) => {
        controlsRef.current = controls
        setCurrentPath(controls.currentPath)
        setCurrentPathDataType(controls.currentPathDataType)
    }, [])

    // Add property handler — delegates to DrillIn's addObjectProperty which
    // knows the current path and handles both root and nested levels
    const handleAddProperty = useCallback((name: string, type: string) => {
        controlsRef.current?.addObjectProperty(name, type as any)
    }, [])

    const isNewRow = testcaseId.startsWith("new-") || testcaseId.startsWith("local-")
    const syncState: SyncState = isNewRow ? "new" : isDirty ? "modified" : "unmodified"
    const isNested = currentPath.length > 0
    const canAddProperty = currentPathDataType === "root" || currentPathDataType === "object"

    const toolbar = useMemo(
        () => (
            <div className="flex items-center gap-1">
                <SyncStateTag syncState={syncState} className="mr-1" />
                <button
                    type="button"
                    onClick={() => setEditMode("fields")}
                    className={`flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer transition-colors ${
                        editMode === "fields"
                            ? "bg-[rgba(0,0,0,0.06)] text-[#1c2c3d]"
                            : "bg-transparent text-[rgba(0,0,0,0.45)] hover:text-[#1c2c3d]"
                    }`}
                >
                    <TreeStructure size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => setEditMode("json")}
                    className={`flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer transition-colors ${
                        editMode === "json"
                            ? "bg-[rgba(0,0,0,0.06)] text-[#1c2c3d]"
                            : "bg-transparent text-[rgba(0,0,0,0.45)] hover:text-[#1c2c3d]"
                    }`}
                >
                    <Code size={14} />
                </button>
            </div>
        ),
        [syncState, editMode],
    )

    return (
        <div>
            {/* Header */}
            <div
                className="flex items-center cursor-pointer select-none"
                style={{padding: "10px 16px", lineHeight: 1.6667}}
                onClick={() => setIsOpen((v) => !v)}
            >
                {/* Left side: "Data" label + breadcrumb path segments */}
                <div
                    className="flex-1 flex items-center gap-0 min-w-0"
                    onClick={(e) => {
                        if (isNested) e.stopPropagation()
                    }}
                >
                    {isNested && editMode === "fields" ? (
                        <button
                            type="button"
                            onClick={() => controlsRef.current?.navigateToIndex(0)}
                            className="bg-transparent border-none cursor-pointer p-0 flex-shrink-0 text-[rgba(0,0,0,0.45)] hover:text-[#1c2c3d]"
                            style={{fontSize: 12, lineHeight: 1.6667}}
                        >
                            Testcase Data
                        </button>
                    ) : (
                        <span style={{fontSize: 12, color: "#1c2c3d", lineHeight: 1.6667}}>
                            Testcase Data
                        </span>
                    )}
                    {isNested &&
                        editMode === "fields" &&
                        currentPath.map((segment, i) => (
                            <div key={i} className="flex items-center flex-shrink-0">
                                <CaretRight size={10} className="text-[rgba(0,0,0,0.25)] mx-0.5" />
                                <button
                                    type="button"
                                    onClick={() => controlsRef.current?.navigateToIndex(i + 1)}
                                    className={`bg-transparent border-none cursor-pointer p-0 flex-shrink-0 ${
                                        i === currentPath.length - 1
                                            ? "text-[#1c2c3d] font-medium"
                                            : "text-[rgba(0,0,0,0.45)] hover:text-[#1c2c3d]"
                                    }`}
                                    style={{fontSize: 12, lineHeight: 1.6667}}
                                >
                                    {segment}
                                </button>
                            </div>
                        ))}
                </div>

                {/* Right side: controls */}
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {editMode === "fields" && canAddProperty && (
                        <AddPropertyForm onAdd={handleAddProperty} mode="popover" />
                    )}
                    {toolbar}
                </div>
                <span
                    className="flex items-center justify-center transition-transform duration-300"
                    style={{
                        height: 22,
                        marginInlineStart: 12,
                        fontSize: 12,
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                >
                    <RightOutlined />
                </span>
            </div>

            {/* Collapsible content */}
            <HeightCollapse open={isOpen}>
                <div className="px-4 pb-3">
                    {editMode === "fields" ? (
                        <EntityDrillInView
                            entityId={testcaseId}
                            entity={testcaseEntityAdapter as any}
                            columns={columns}
                            rootTitle="Data"
                            editable
                            showDeleteControls
                            hideBreadcrumb
                            renderExternalControls={handleExternalControls}
                        />
                    ) : (
                        <div
                            className={
                                syncState === "modified"
                                    ? "[&_.agenta-shared-editor]:border-blue-400"
                                    : ""
                            }
                        >
                            <JsonEditorWithLocalState
                                editorKey={`focus-testcase-${testcaseId}-json`}
                                initialValue={jsonValue}
                                onValidChange={handleJsonChange}
                            />
                        </div>
                    )}
                </div>
            </HeightCollapse>
        </div>
    )
}

export default PlaygroundTestcaseEditor
