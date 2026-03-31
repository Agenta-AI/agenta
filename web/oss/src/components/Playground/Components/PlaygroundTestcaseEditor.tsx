import {useCallback, useMemo, useState} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {executionItemController} from "@agenta/playground"
import {HeightCollapse, SyncStateTag, type SyncState} from "@agenta/ui"
import {RightOutlined} from "@ant-design/icons"
import {Code, TreeStructure} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {EntityDrillInView, JsonEditorWithLocalState} from "@/oss/components/DrillInView"
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

/**
 * Entity adapter that maps testcaseMolecule → EntityAPI interface.
 *
 * EntityDrillInView expects:
 *   entity.selectors.data(id)        → Atom<T | null>
 *   entity.controller(id)            → WritableAtom (dispatch)
 *   entity.drillIn.getValueAtPath    → pure read
 *   entity.drillIn.getRootItems      → root items (columns)
 *   entity.drillIn.valueMode         → "native"
 */
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

/**
 * Testcase editor for the playground focus drawer.
 *
 * Uses the OSS EntityDrillInView for fields mode (same rendering as TestcaseEditDrawer)
 * and JsonEditorWithLocalState for JSON mode — backed by testcaseMolecule data.
 */
function PlaygroundTestcaseEditor({testcaseId}: {testcaseId: string}) {
    const [editMode, setEditMode] = useState<EditMode>("fields")
    const [isOpen, setIsOpen] = useState(true)

    const entityData = useAtomValue(useMemo(() => testcaseMolecule.data(testcaseId), [testcaseId]))
    const isDirty = useAtomValue(useMemo(() => testcaseMolecule.isDirty(testcaseId), [testcaseId]))

    // Derive columns from the molecule, filtering out internal fields.
    // Fall back to schema-based variable keys when testcase data is empty
    // (e.g., newly created testcase with no testset connected).
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

    // JSON editor value — only user-facing column data
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

    // Locally-created testcases have no server counterpart so isDirty is
    // always true. Show "New" (green) for those instead of "Edited" (blue).
    const isNewRow = testcaseId.startsWith("new-") || testcaseId.startsWith("local-")
    const syncState: SyncState = isNewRow ? "new" : isDirty ? "modified" : "unmodified"

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
            {/* Header — matches Ant Design Collapse header style */}
            <div
                className="flex items-center cursor-pointer select-none"
                style={{padding: "10px 16px", lineHeight: 1.6667}}
                onClick={() => setIsOpen((v) => !v)}
            >
                <span className="flex-1" style={{fontSize: 12, color: "#1c2c3d"}}>
                    Data
                </span>
                {/* Stop propagation so toggling edit mode doesn't collapse */}
                <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
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
                            showAddControls
                            showDeleteControls
                            hideRootBreadcrumb
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
