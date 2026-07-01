/**
 * WorkflowReferenceSelector
 *
 * Two-panel master/detail drawer for referencing a workflow as an agent tool
 * (`type:"reference"`, #4860). Left rail: a searchable, type-badged list with present-only
 * filter chips. Right panel: the selected workflow's detail — description, the tool name it's
 * exposed as, the resolved input schema, and the axis controls (by variant/version or by
 * environment) — then Add. When nothing is selected the detail panel shows a resting hint
 * rather than dead space.
 *
 * Styling uses antd semantic tokens (`--ag-color*`) + antd `Tag` (theme-aware) only — dark-safe.
 * Built on the shared `EnhancedDrawer`.
 */
import {useEffect, useMemo, useState} from "react"

import {ConfigAccordionSection, CopyButton} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import type {
    WorkflowConfigPart,
    WorkflowReferenceBridge,
    WorkflowReferencePayload,
    WorkflowReferenceType,
    WorkflowReferenceUI,
} from "@agenta/ui/drill-in"
import {
    GitBranch,
    GraphIcon,
    HandPointing,
    MagnifyingGlass,
    SlidersHorizontal,
    TreeStructure,
} from "@phosphor-icons/react"
import {Empty, Input, Segmented, Skeleton, Spin, Tag} from "antd"
import {atom, useSetAtom} from "jotai"

import {DrawerFooter} from "../../drawers/shared/DrawerFooter"
import {SectionRail} from "../../drawers/shared/SectionRail"
import {RunVersionField} from "../../gatewayTrigger/drawers/shared/RunVersionField"
import {createWorkflowRevisionAdapter, type WorkflowRevisionSelectionResult} from "../../selection"

import {CodeEditor, type CodeEditorLanguage} from "./CodeEditor"
import {SchemaTree} from "./SchemaTree"

export interface WorkflowReferenceSelectorProps {
    open: boolean
    onClose: () => void
    /** Workflows available to reference (the caller filters out already-referenced ones). */
    workflows: WorkflowReferenceUI[]
    /** Supplies the per-workflow revision, environment, and input-schema lookups. */
    bridge: WorkflowReferenceBridge
    /** Emit the chosen reference (axis + slug + version/environment). */
    onSelect: (payload: WorkflowReferencePayload) => void
}

// Workflow-scoped revision picker (2-level Variant → Revision) for the shared RunVersionField.
// The atom is synced to the selected workflow so the cascader is scoped to it.
const refWorkflowIdAtom = atom<string | null>(null)
const referenceRevisionAdapter = createWorkflowRevisionAdapter({workflowIdAtom: refWorkflowIdAtom})

// antd named colors adapt to dark mode via the theme algorithm.
const TYPE_BADGE: Record<WorkflowReferenceType, {color: string; label: string}> = {
    agent: {color: "purple", label: "agent"},
    chat: {color: "blue", label: "chat"},
    completion: {color: "cyan", label: "completion"},
    custom: {color: "gold", label: "custom"},
    evaluator: {color: "green", label: "evaluator"},
}

// Filter by the workflow's actual type, so the chips read the same as the row badges.
type TypeFilter = "all" | WorkflowReferenceType

const TYPE_FILTER_ORDER: WorkflowReferenceType[] = [
    "completion",
    "chat",
    "agent",
    "custom",
    "evaluator",
]

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const noop = () => {}

// Contained render of a Configuration part: the prompt "Messages" render as a role-tagged list;
// plain text wraps in a box; code/JSON use the app's read-only code editor. Long content never grows
// the panel (max-height + internal scroll).
function ConfigPartContent({part}: {part: WorkflowConfigPart}) {
    if (part.kind === "messages" && part.messages) {
        return (
            <div className="flex max-h-[360px] max-w-prose flex-col gap-3 overflow-y-auto overscroll-contain">
                {part.messages.map((message, i) => (
                    <div key={i} className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                            {capitalize(message.role)}
                        </span>
                        <div className="whitespace-pre-wrap break-words rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] px-2.5 py-2 text-xs leading-relaxed text-[var(--ag-colorText)]">
                            {message.content}
                        </div>
                    </div>
                ))}
            </div>
        )
    }
    if (part.kind === "text") {
        return (
            <div className="max-h-[320px] max-w-prose overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] px-2.5 py-2 text-xs leading-relaxed text-[var(--ag-colorText)]">
                {part.content}
            </div>
        )
    }
    const language: CodeEditorLanguage =
        part.kind === "json" ? "json" : ((part.language ?? "code") as CodeEditorLanguage)
    return (
        <div className="max-h-[360px] max-w-prose overflow-auto overscroll-contain">
            <CodeEditor value={part.content} onChange={noop} language={language} disabled />
        </div>
    )
}

function TypeBadge({type, label}: {type: WorkflowReferenceType | undefined; label?: string}) {
    if (!type) return null
    const cfg = TYPE_BADGE[type]
    return (
        <Tag
            color={cfg.color}
            className="m-0 max-w-[140px] truncate px-1.5 py-0 text-[10px] leading-[18px]"
            bordered={false}
        >
            {label || cfg.label}
        </Tag>
    )
}

export function WorkflowReferenceSelector({
    open,
    onClose,
    workflows,
    bridge,
    onSelect,
}: WorkflowReferenceSelectorProps) {
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState<TypeFilter>("all")
    const [selected, setSelected] = useState<WorkflowReferenceUI | null>(null)
    // bindMode mirrors RunVersionField: "revision" (pin a variant+revision) | "environment" (deployed).
    const [bindMode, setBindMode] = useState<"revision" | "environment">("revision")
    const [version, setVersion] = useState<string | undefined>(undefined)
    const [environment, setEnvironment] = useState<string | undefined>(undefined)
    const [inputSchema, setInputSchema] = useState<Record<string, unknown> | null>(null)
    const [outputSchema, setOutputSchema] = useState<Record<string, unknown> | null>(null)
    const [schemaLoading, setSchemaLoading] = useState(false)
    // Schema section's left-rail selection (Inputs / Outputs). Outputs appears only when the
    // bridge resolves an output schema; otherwise the rail shows Inputs alone.
    const [schemaTab, setSchemaTab] = useState<"inputs" | "outputs">("inputs")
    // Configuration section: type-specific parts (code / prompt+model / agent) + selected part.
    const [configParts, setConfigParts] = useState<WorkflowConfigPart[]>([])
    const [configLoading, setConfigLoading] = useState(false)
    const [configPartKey, setConfigPartKey] = useState<string | null>(null)
    const setRefWorkflowId = useSetAtom(refWorkflowIdAtom)

    // Scope the revision picker to the selected workflow.
    useEffect(() => {
        setRefWorkflowId(selected?.id ?? null)
    }, [selected?.id, setRefWorkflowId])

    // Reset to a clean list state whenever the drawer is (re)opened.
    useEffect(() => {
        if (!open) return
        setSearch("")
        setFilter("all")
        setSelected(null)
    }, [open])

    // Reset the axis selection when the chosen workflow changes, so a previous pick doesn't bleed in.
    useEffect(() => {
        setBindMode("revision")
        setVersion(undefined)
        setEnvironment(undefined)
        setSchemaTab("inputs")
        setConfigPartKey(null)
    }, [selected?.id])

    // Resolve the selected workflow's input + output schemas for the Schema section.
    useEffect(() => {
        if (!selected) {
            setInputSchema(null)
            setOutputSchema(null)
            return
        }
        let cancelled = false
        setSchemaLoading(true)
        setInputSchema(null)
        setOutputSchema(null)
        Promise.all([
            bridge.resolveInputSchema(selected).catch(() => null),
            bridge.resolveOutputSchema?.(selected).catch(() => null) ?? Promise.resolve(null),
        ])
            .then(([input, output]) => {
                if (cancelled) return
                setInputSchema(input)
                setOutputSchema(output)
            })
            .finally(() => {
                if (!cancelled) setSchemaLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [selected, bridge])

    // Resolve the selected workflow's type-specific configuration for the Configuration section.
    useEffect(() => {
        if (!selected || !bridge.resolveConfigPayload) {
            setConfigParts([])
            return
        }
        let cancelled = false
        setConfigLoading(true)
        setConfigParts([])
        bridge
            .resolveConfigPayload(selected)
            .then((payload) => {
                if (!cancelled) setConfigParts(payload?.parts ?? [])
            })
            .catch(() => {
                if (!cancelled) setConfigParts([])
            })
            .finally(() => {
                if (!cancelled) setConfigLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [selected, bridge])

    const {environments, isLoading: environmentsLoading} = bridge.useWorkflowEnvironments(selected)

    // The picker selects a leaf id + carries the revision's version number in metadata. A leaf that
    // equals the variant id means "the variant" (latest → no pinned version); else pin that version.
    const handleRevisionSelect = (sel: WorkflowRevisionSelectionResult) => {
        const isRevision = Boolean(sel.metadata.variantId) && sel.id !== sel.metadata.variantId
        setVersion(isRevision ? String(sel.metadata.revision) : undefined)
    }

    // List items carry no type (capability flags live on the revision URI), so the bridge resolves
    // types by slug — plus a finer badge label for evaluators (their kind). Merge both in so badges,
    // filter chips, and detail all read the real type.
    const {typeBySlug, labelBySlug} = bridge.useWorkflowTypes(workflows)
    const typedWorkflows = useMemo(
        () =>
            workflows.map((w) => ({
                ...w,
                type: typeBySlug[w.slug] ?? w.type,
                typeLabel: labelBySlug?.[w.slug] ?? w.typeLabel,
            })),
        [workflows, typeBySlug, labelBySlug],
    )

    // Filter chips: only the types present in the available workflows (plus "All").
    const filterOptions = useMemo(() => {
        const present = new Set(typedWorkflows.map((w) => w.type).filter(Boolean))
        const opts: {label: string; value: TypeFilter}[] = [{label: "All", value: "all"}]
        for (const t of TYPE_FILTER_ORDER) {
            if (present.has(t)) opts.push({label: capitalize(t), value: t})
        }
        return opts
    }, [typedWorkflows])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        return typedWorkflows.filter((w) => {
            if (filter !== "all" && w.type !== filter) return false
            if (!q) return true
            return `${w.slug} ${w.name ?? ""} ${w.description ?? ""}`.toLowerCase().includes(q)
        })
    }, [typedWorkflows, search, filter])

    const countProps = (schema: Record<string, unknown> | null): number =>
        isRecord(schema?.properties) ? Object.keys(schema!.properties).length : 0

    // Left-rail tabs for the Schema section. Outputs appears only when the bridge resolves an
    // output schema with declared properties.
    const schemaTabs = useMemo(() => {
        const tabs: {
            key: "inputs" | "outputs"
            label: string
            count: number
            schema: Record<string, unknown> | null
        }[] = [
            {key: "inputs", label: "Inputs", count: countProps(inputSchema), schema: inputSchema},
        ]
        if (countProps(outputSchema) > 0) {
            tabs.push({
                key: "outputs",
                label: "Outputs",
                count: countProps(outputSchema),
                schema: outputSchema,
            })
        }
        return tabs
    }, [inputSchema, outputSchema])
    const activeSchema =
        schemaTabs.find((t) => t.key === schemaTab)?.schema ?? schemaTabs[0]?.schema ?? null

    // Configuration section: the selected part (defaults to the first) and its content.
    const activeConfigPart =
        configParts.find((p) => p.key === configPartKey) ?? configParts[0] ?? null

    const canConfirm = Boolean(selected) && (bindMode === "revision" || Boolean(environment))

    const handleConfirm = () => {
        if (!selected) return
        if (bindMode === "environment" && !environment) return
        onSelect({
            slug: selected.slug,
            refBy: bindMode === "revision" ? "variant" : "environment",
            version: bindMode === "revision" ? version : undefined,
            environment: bindMode === "environment" ? environment : undefined,
        })
        onClose()
    }

    return (
        <EnhancedDrawer
            open={open}
            onClose={onClose}
            placement="right"
            width={960}
            destroyOnClose
            title={
                <div className="flex items-center gap-2">
                    <GraphIcon size={16} />
                    <span className="text-sm font-medium">Reference a workflow</span>
                </div>
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            <div className="flex min-h-0 flex-1">
                {/* Master rail */}
                <div className="flex w-[260px] shrink-0 flex-col border-0 border-r border-solid border-[var(--ag-colorBorderSecondary)]">
                    <div className="shrink-0 border-0 border-b border-solid border-[var(--ag-colorBorderSecondary)] p-3">
                        <Input
                            prefix={
                                <MagnifyingGlass
                                    size={14}
                                    className="text-[var(--ag-colorTextTertiary)]"
                                />
                            }
                            placeholder="Search workflows"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            allowClear
                        />
                        <p className="m-0 mt-2 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                            The agent calls the chosen workflow as a tool; it runs server-side and
                            returns its output.
                        </p>
                        {filterOptions.length > 1 && (
                            <div className="mt-2 overflow-x-auto">
                                <Segmented
                                    className="w-max"
                                    value={filter}
                                    onChange={(val) => setFilter(val as TypeFilter)}
                                    options={filterOptions}
                                />
                            </div>
                        )}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                        {bridge.workflowsLoading ? (
                            <div className="flex justify-center py-6">
                                <Spin size="small" />
                            </div>
                        ) : filtered.length === 0 ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                                        No workflows to reference
                                    </span>
                                }
                            />
                        ) : (
                            <div className="flex flex-col gap-0.5">
                                {filtered.map((wf) => (
                                    <button
                                        type="button"
                                        key={wf.id}
                                        onClick={() => setSelected(wf)}
                                        className={`flex w-full items-center gap-2 rounded-md border-none px-2 py-2 text-left [font:inherit] ${
                                            selected?.id === wf.id
                                                ? "bg-[var(--ag-colorFillSecondary)]"
                                                : "cursor-pointer bg-transparent hover:bg-[var(--ag-colorFillTertiary)]"
                                        }`}
                                    >
                                        <GraphIcon
                                            size={15}
                                            className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                                        />
                                        <span className="flex min-w-0 flex-1 flex-col leading-tight">
                                            <span className="truncate text-xs text-[var(--ag-colorText)]">
                                                {wf.name || wf.slug}
                                            </span>
                                            <span className="truncate text-[10px] text-[var(--ag-colorTextTertiary)]">
                                                {wf.slug}
                                            </span>
                                        </span>
                                        <TypeBadge type={wf.type} label={wf.typeLabel} />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Detail */}
                <div className="flex min-w-0 flex-1 flex-col">
                    {!selected ? (
                        <div className="flex flex-1 items-center justify-center p-6">
                            <div className="max-w-[230px] text-center">
                                <HandPointing
                                    size={30}
                                    className="mx-auto text-[var(--ag-colorTextTertiary)]"
                                />
                                <div className="mb-1.5 mt-3 text-sm font-medium text-[var(--ag-colorText)]">
                                    Select a workflow
                                </div>
                                <p className="m-0 text-xs leading-relaxed text-[var(--ag-colorTextTertiary)]">
                                    Preview its inputs and pick a version before adding it as a
                                    tool.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                            <div>
                                {/* Header: workflow identity, above the sections */}
                                <div className="flex items-center gap-2 pt-4">
                                    <GraphIcon
                                        size={18}
                                        className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                                    />
                                    <span className="truncate text-sm font-medium text-[var(--ag-colorText)]">
                                        {selected.name || selected.slug}
                                    </span>
                                    <TypeBadge type={selected.type} label={selected.typeLabel} />
                                </div>
                                {selected.description ? (
                                    <p className="m-0 mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--ag-colorTextSecondary)]">
                                        {selected.description}
                                    </p>
                                ) : null}

                                {/* Exposed-as: a root-level field (no section chrome), 2-panel to
                                    align with the sections' [rail | content] rhythm below. */}
                                <div className="flex gap-3 border-0 border-b border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] py-3">
                                    <div className="box-border w-[116px] shrink-0 px-2.5 pt-1 text-xs text-[var(--ag-colorTextSecondary)]">
                                        Exposed as
                                    </div>
                                    <div className="flex min-w-0 flex-1 flex-col border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                                        <div className="flex w-fit max-w-full items-center gap-1 rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] py-0.5 pl-2.5 pr-1 font-mono text-xs text-[var(--ag-colorText)]">
                                            <span className="truncate">{selected.slug}</span>
                                            <CopyButton
                                                text={selected.slug}
                                                buttonText={null}
                                                icon
                                                type="text"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <ConfigAccordionSection
                                    size="compact"
                                    icon={<TreeStructure size={15} />}
                                    title="Schema"
                                    summary={`Inputs · ${countProps(inputSchema)}`}
                                    summaryCollapsedOnly
                                >
                                    {schemaLoading ? (
                                        <Skeleton
                                            active
                                            title={false}
                                            paragraph={{rows: 3, width: ["60%", "80%", "45%"]}}
                                        />
                                    ) : (
                                        <SectionRail
                                            items={schemaTabs.map((t) => ({
                                                value: t.key,
                                                label: t.label,
                                                count: t.count,
                                            }))}
                                            value={schemaTab}
                                            onChange={(v) =>
                                                setSchemaTab(v as "inputs" | "outputs")
                                            }
                                        >
                                            <div className="max-h-[320px] max-w-prose overflow-y-auto overscroll-contain">
                                                <SchemaTree
                                                    schema={activeSchema}
                                                    emptyText={
                                                        schemaTab === "outputs"
                                                            ? "No declared outputs"
                                                            : "No declared inputs"
                                                    }
                                                />
                                            </div>
                                        </SectionRail>
                                    )}
                                </ConfigAccordionSection>

                                {(configLoading || configParts.length > 0) && (
                                    <ConfigAccordionSection
                                        size="compact"
                                        icon={<SlidersHorizontal size={15} />}
                                        title="Configuration"
                                        summary={
                                            configParts.length
                                                ? `${configParts.length} ${
                                                      configParts.length === 1 ? "part" : "parts"
                                                  }`
                                                : undefined
                                        }
                                        summaryCollapsedOnly
                                    >
                                        {configLoading ? (
                                            <Skeleton
                                                active
                                                title={false}
                                                paragraph={{
                                                    rows: 4,
                                                    width: ["70%", "90%", "80%", "50%"],
                                                }}
                                            />
                                        ) : (
                                            <SectionRail
                                                items={configParts.map((p) => ({
                                                    value: p.key,
                                                    label: p.label,
                                                }))}
                                                value={activeConfigPart?.key ?? ""}
                                                onChange={setConfigPartKey}
                                            >
                                                {activeConfigPart ? (
                                                    <ConfigPartContent part={activeConfigPart} />
                                                ) : null}
                                            </SectionRail>
                                        )}
                                    </ConfigAccordionSection>
                                )}

                                <ConfigAccordionSection
                                    size="compact"
                                    collapsible={false}
                                    noDivider
                                    icon={<GitBranch size={15} />}
                                    title="Reference by"
                                    status={canConfirm ? "complete" : "warning"}
                                >
                                    <RunVersionField
                                        bindMode={bindMode}
                                        onBindModeChange={setBindMode}
                                        revisionAdapter={referenceRevisionAdapter}
                                        revisionPlaceholder="Latest revision"
                                        onRevisionSelect={handleRevisionSelect}
                                        revisionHint="Pin one variant + revision, or pick a variant to follow its latest."
                                        envOptions={environments.map((env) => ({
                                            value: env.slug,
                                            label: env.name || env.slug,
                                        }))}
                                        envLoading={environmentsLoading}
                                        environmentSlug={environment}
                                        onEnvironmentChange={setEnvironment}
                                        envNotFound={
                                            environmentsLoading ? (
                                                <Spin size="small" />
                                            ) : (
                                                <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                                                    No environments deployed
                                                </span>
                                            )
                                        }
                                        envHint="Calls whatever revision is deployed in the chosen environment."
                                    />
                                </ConfigAccordionSection>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <DrawerFooter
                onCancel={onClose}
                onSubmit={handleConfirm}
                submitLabel="Add reference"
                canSave={canConfirm}
            />
        </EnhancedDrawer>
    )
}
