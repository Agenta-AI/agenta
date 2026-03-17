/**
 * ConfigurationView
 *
 * Read-only view of queue configuration — uses the same collapsible section
 * pattern as the evaluation run details ConfigurationView.
 *
 * Sections: General, Evaluators, Collaborator settings.
 */

import {memo, useCallback, useEffect, useMemo, useState} from "react"
import type {KeyboardEvent, PropsWithChildren} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {workflowMolecule} from "@agenta/entities/workflow"
import {Editor} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {ArrowSquareOut, CaretDown} from "@phosphor-icons/react"
import {Button, Form, Input, Segmented, Skeleton, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import AssignmentsCell from "../AnnotationQueuesView/cells/AssignmentsCell"

const {Text} = Typography

// ============================================================================
// SECTION PRIMITIVES (matching eval run config pattern)
// ============================================================================

function SectionCard({children, className}: PropsWithChildren<{className?: string}>) {
    return (
        <div
            className={`flex flex-col gap-4 border-[0.5px] border-solid border-[#EAEFF5] bg-white p-4 ${className ?? ""}`}
        >
            {children}
        </div>
    )
}

function CollapsibleSection({
    title,
    defaultCollapsed = false,
    children,
}: PropsWithChildren<{title: string; defaultCollapsed?: boolean}>) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed)

    const toggle = useCallback(() => setCollapsed((v) => !v), [])
    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                toggle()
            }
        },
        [toggle],
    )

    return (
        <div className="flex flex-col">
            <div
                className="flex items-center justify-between py-1 px-3 h-10 cursor-pointer bg-[#05172905] rounded-t-lg"
                style={{borderBottom: "1px solid #EAEFF5"}}
                role="button"
                tabIndex={0}
                onClick={toggle}
                onKeyDown={handleKeyDown}
            >
                <Text className="text-sm font-semibold text-[#344054]">{title}</Text>
                <Button
                    type="link"
                    size="small"
                    icon={
                        <CaretDown
                            size={12}
                            style={{
                                transform: collapsed ? "rotate(-90deg)" : undefined,
                                transition: "transform 0.2s",
                            }}
                        />
                    }
                    onClick={(e) => {
                        e.stopPropagation()
                        toggle()
                    }}
                />
            </div>
            {!collapsed && <div className="pb-2">{children}</div>}
        </div>
    )
}

function EmptyValue() {
    return <Text type="secondary">—</Text>
}

// ============================================================================
// EVALUATOR HELPERS
// ============================================================================

/** Format a parameter key into a human-readable label (snake_case/camelCase → Title Case) */
function formatParameterLabel(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) return "Parameter"
    const withSpaces = trimmed
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    if (!withSpaces) return "Parameter"
    return withSpaces
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}

/** Stringify a parameter value for display */
function stringifyParamValue(value: unknown): string {
    if (value == null) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

interface OutputMetric {
    name: string
    type: string
    required: boolean
    description?: string
}

/** Parse output metrics from a JSON Schema (data.schemas.outputs) */
function parseOutputMetrics(schema: unknown): OutputMetric[] {
    if (!schema || typeof schema !== "object") return []
    const node = schema as Record<string, unknown>
    const properties = node.properties as Record<string, unknown> | undefined
    if (!properties || typeof properties !== "object") return []

    const requiredList = Array.isArray(node.required)
        ? (node.required as unknown[]).map(String)
        : []

    return Object.entries(properties)
        .map(([name, definition]) => {
            if (!definition || typeof definition !== "object") return null
            const def = definition as Record<string, unknown>
            // Derive type string
            let type = "unknown"
            if (typeof def.type === "string") type = def.type
            else if (Array.isArray(def.type))
                type = (def.type as string[]).filter(Boolean).join(" | ")
            else if (Array.isArray(def.enum))
                type = `enum(${(def.enum as unknown[]).map(String).join(", ")})`

            const description =
                typeof def.description === "string" ? def.description.trim() : undefined

            return {name, type, required: requiredList.includes(name), description}
        })
        .filter(Boolean) as OutputMetric[]
}

/** Keys to hide from parameter display */
const PARAM_KEYS_TO_HIDE = new Set([
    "messages",
    "prompt_template",
    "ag_config",
    "agconfig",
    "agConfig",
])

interface ParameterEntry {
    key: string
    label: string
    displayValue: string
    isMultiline: boolean
}

/** Safely access a nested path on an object */
function getNestedValue(obj: unknown, ...keys: string[]): unknown {
    let current: unknown = obj
    for (const key of keys) {
        if (!current || typeof current !== "object") return undefined
        current = (current as Record<string, unknown>)[key]
    }
    return current
}

/** Extract displayable parameters from evaluator data (checks multiple legacy paths) */
function extractParameters(data: Record<string, unknown> | null | undefined): ParameterEntry[] {
    if (!data) return []

    // Try multiple parameter sources (matching OSS evaluatorDetails.ts pattern)
    const candidates = [
        data.parameters,
        getNestedValue(data, "service", "configuration", "parameters"),
        getNestedValue(data, "configuration", "parameters"),
    ]

    for (const source of candidates) {
        if (!source || typeof source !== "object") continue
        const entries = Object.entries(source as Record<string, unknown>)
            .filter(([key, v]) => {
                if (v === null || v === undefined) return false
                return !PARAM_KEYS_TO_HIDE.has(key) && !PARAM_KEYS_TO_HIDE.has(key.toLowerCase())
            })
            .map(([key, value]) => {
                const displayValue = stringifyParamValue(value)
                return {
                    key,
                    label: formatParameterLabel(key),
                    displayValue,
                    isMultiline: displayValue.includes("\n"),
                }
            })
            .filter((entry) => entry.displayValue.trim().length > 0)
        if (entries.length > 0) return entries
    }

    return []
}

/**
 * Resolve output metrics schema from evaluator data.
 * Checks multiple paths matching the OSS evaluatorDetails.ts pattern:
 *   data.schemas.outputs
 *   data.service.format.properties.outputs
 *   data.service.configuration.outputs
 *   data.configuration.outputs
 */
function resolveOutputSchema(data: Record<string, unknown> | null | undefined): unknown {
    if (!data) return null
    const candidates = [
        getNestedValue(data, "schemas", "outputs"),
        getNestedValue(data, "service", "format", "properties", "outputs"),
        getNestedValue(data, "service", "configuration", "outputs"),
        getNestedValue(data, "configuration", "outputs"),
        getNestedValue(data, "service", "configuration", "format", "properties", "outputs"),
        getNestedValue(data, "configuration", "format", "properties", "outputs"),
    ]
    for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") {
            const metrics = parseOutputMetrics(candidate)
            if (metrics.length > 0) return candidate
        }
    }
    return null
}

/** Derive evaluator type label from URI (e.g. "agenta:builtin:auto_exact_match:v0" → "Exact Match") */
function deriveTypeLabel(uri: string | null | undefined): string | null {
    if (!uri) return null
    // Parse key from URI: agenta:builtin:<key>:v0
    const parts = uri.split(":")
    const key = parts.length >= 3 ? parts[2] : null
    if (!key) return null
    // Convert to display label
    const withoutPrefix = key.startsWith("auto_") ? key.slice(5) : key
    return withoutPrefix
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}

// ============================================================================
// READ-ONLY BOX (matches eval run details ReadOnlyBox pattern)
// ============================================================================

function ReadOnlyBox({children, className}: PropsWithChildren<{className?: string}>) {
    return (
        <div
            className={`rounded border border-solid border-[#E4E7EC] bg-[#F9FAFB] px-2.5 py-1.5 ${className ?? ""}`}
        >
            {children}
        </div>
    )
}

// ============================================================================
// EVALUATOR CARD
// ============================================================================

/** Derive the project base URL from the current pathname (e.g. /w/.../p/...) */
function getProjectBaseUrl(): string | null {
    if (typeof window === "undefined") return null
    const match = /^(\/w\/[^/]+\/p\/[^/]+)/.exec(window.location.pathname)
    return match?.[1] ?? null
}

const EvaluatorCard = memo(function EvaluatorCard({evaluatorId}: {evaluatorId: string}) {
    const [collapsed, setCollapsed] = useState(false)
    const [view, setView] = useState<"details" | "json">("details")

    const query = useAtomValue(workflowMolecule.selectors.query(evaluatorId))
    const evaluator = useAtomValue(workflowMolecule.selectors.data(evaluatorId))

    const displayName = evaluator?.name || evaluator?.slug || evaluatorId.slice(0, 8)
    const isHuman = evaluator?.flags?.is_human ?? false
    const isCustom = evaluator?.flags?.is_custom ?? false
    const version = evaluator?.version
    const description = evaluator?.description
    const uri = evaluator?.data?.uri
    const typeLabel = deriveTypeLabel(uri)
    const workflowId = evaluator?.workflow_id ?? evaluatorId

    const evaluatorHref = useMemo(() => {
        const base = getProjectBaseUrl()
        return base ? `${base}/evaluators/configure/${workflowId}` : undefined
    }, [workflowId])

    const paramEntries = useMemo(
        () => extractParameters(evaluator?.data as Record<string, unknown> | null),
        [evaluator?.data],
    )

    const resolvedOutputSchema = useMemo(
        () => resolveOutputSchema(evaluator?.data as Record<string, unknown> | null),
        [evaluator?.data],
    )

    const outputMetrics = useMemo(
        () => parseOutputMetrics(resolvedOutputSchema),
        [resolvedOutputSchema],
    )

    // Serialize evaluator to JSON for the JSON view
    const evaluatorJson = useMemo(() => {
        if (!evaluator) return ""
        const seen = new WeakSet()
        try {
            return JSON.stringify(
                evaluator,
                (_key, value) => {
                    if (typeof value === "object" && value !== null) {
                        if (seen.has(value)) return "[Circular]"
                        seen.add(value)
                    }
                    if (typeof value === "function") return undefined
                    return value
                },
                2,
            )
        } catch {
            return ""
        }
    }, [evaluator])

    const hasEvaluatorJson = evaluatorJson.trim().length > 0

    const evaluatorJsonKey = useMemo(() => {
        const prefix = evaluator?.id ?? evaluatorId
        if (!hasEvaluatorJson) return `${prefix}-empty`
        const sample = evaluatorJson.slice(0, 32)
        return `${prefix}-${sample.length}-${sample}`
    }, [evaluator?.id, evaluatorId, evaluatorJson, hasEvaluatorJson])

    if (query.isPending) {
        return (
            <SectionCard>
                <Skeleton active paragraph={{rows: 2}} title={false} />
            </SectionCard>
        )
    }

    return (
        <SectionCard className="!gap-0 !p-0 overflow-hidden">
            {/* Evaluator header */}
            <div
                className="flex h-10 items-center justify-between gap-2 bg-[rgba(5,23,41,0.02)] px-3"
                style={{
                    borderBottom:
                        "var(--Components-Collapse-Global-lineWidth, 1px) solid var(--Colors-Neutral-Border-colorSplit, rgba(5, 23, 41, 0.06))",
                }}
            >
                <div className="flex min-w-0 items-center gap-2">
                    {evaluatorHref ? (
                        <Tag
                            className="!m-0 !bg-[#F2F4F7] !border-[#D0D5DD] !text-[#1D2939] cursor-pointer"
                            icon={<ArrowSquareOut size={12} className="mr-1" />}
                            onClick={() => window.open(evaluatorHref, "_blank")}
                        >
                            {displayName}
                        </Tag>
                    ) : (
                        <Tag className="!m-0 !bg-[#F2F4F7] !border-[#D0D5DD] !text-[#1D2939]">
                            {displayName}
                        </Tag>
                    )}
                    {version ? (
                        <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 text-xs font-medium text-[#475467]">
                            V{version}
                        </span>
                    ) : null}
                    {isHuman && (
                        <Tag color="purple" className="!m-0">
                            Human
                        </Tag>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {hasEvaluatorJson && (
                        <Segmented
                            options={[
                                {label: "Details", value: "details"},
                                {label: "JSON", value: "json"},
                            ]}
                            size="small"
                            value={view}
                            onChange={(val) => setView(val as "details" | "json")}
                        />
                    )}
                    <Button
                        type="text"
                        size="small"
                        icon={
                            <CaretDown
                                size={12}
                                style={{
                                    transform: collapsed ? "rotate(-90deg)" : undefined,
                                    transition: "transform 0.2s",
                                }}
                            />
                        }
                        onClick={() => setCollapsed((v) => !v)}
                    />
                </div>
            </div>

            {!collapsed && (
                <div className="flex flex-col gap-4 p-3">
                    {view === "json" && hasEvaluatorJson ? (
                        <div className="rounded-md border border-solid border-[#E4E7EC] bg-[#F8FAFC]">
                            <Editor
                                key={evaluatorJsonKey}
                                initialValue={evaluatorJson}
                                language="json"
                                codeOnly
                                showToolbar={false}
                                disabled
                                enableResize={false}
                                boundWidth
                                dimensions={{width: "100%", height: 260}}
                            />
                        </div>
                    ) : (
                        <Form layout="vertical" requiredMark={false}>
                            {/* Evaluator type */}
                            {typeLabel && (
                                <Form.Item label="Evaluator type" style={{marginBottom: 12}}>
                                    <Tag
                                        color={isHuman ? "purple" : isCustom ? "blue" : "default"}
                                        className="!m-0"
                                    >
                                        {typeLabel}
                                    </Tag>
                                </Form.Item>
                            )}

                            {/* Description */}
                            {description && (
                                <Form.Item label="Description" style={{marginBottom: 12}}>
                                    <Text type="secondary">{description}</Text>
                                </Form.Item>
                            )}

                            {/* Parameters */}
                            {paramEntries.map((param) => (
                                <Form.Item
                                    key={param.key}
                                    label={param.label}
                                    style={{marginBottom: 12}}
                                >
                                    <ReadOnlyBox>
                                        {param.isMultiline ? (
                                            <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-[#1D2939]">
                                                {param.displayValue}
                                            </pre>
                                        ) : (
                                            <span className="text-[#1D2939] break-words">
                                                {param.displayValue}
                                            </span>
                                        )}
                                    </ReadOnlyBox>
                                </Form.Item>
                            ))}

                            {/* Output metrics */}
                            {outputMetrics.map((metric, index) => (
                                <Form.Item
                                    key={metric.name}
                                    label={index === 0 ? "Output metrics" : ""}
                                    colon={index === 0}
                                    style={{marginBottom: 12}}
                                >
                                    <ReadOnlyBox>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold text-[#475467]">
                                                {metric.name}
                                            </span>
                                            <Tag className="!m-0" bordered={false}>
                                                {metric.type}
                                            </Tag>
                                            {metric.required ? (
                                                <Tag
                                                    className="!m-0"
                                                    bordered={false}
                                                    color="success"
                                                >
                                                    Required
                                                </Tag>
                                            ) : (
                                                <Tag
                                                    className="!m-0"
                                                    bordered={false}
                                                    style={{
                                                        backgroundColor: "#F2F4F7",
                                                        color: "#475467",
                                                    }}
                                                >
                                                    Optional
                                                </Tag>
                                            )}
                                        </div>
                                        {metric.description && (
                                            <div className="mt-1 text-[#475467]">
                                                {metric.description}
                                            </div>
                                        )}
                                    </ReadOnlyBox>
                                </Form.Item>
                            ))}
                        </Form>
                    )}
                </div>
            )}
        </SectionCard>
    )
})

// ============================================================================
// EVALUATORS SECTION
// ============================================================================

const EvaluatorsSection = memo(function EvaluatorsSection() {
    const evaluatorIds = useAtomValue(annotationSessionController.selectors.evaluatorIds())

    if (evaluatorIds.length === 0) {
        return (
            <SectionCard>
                <Text type="secondary">No evaluators configured for this queue.</Text>
            </SectionCard>
        )
    }

    return (
        <div className="flex flex-col">
            {evaluatorIds.map((id) => (
                <EvaluatorCard key={id} evaluatorId={id} />
            ))}
        </div>
    )
})

// ============================================================================
// COMPONENT
// ============================================================================

interface ConfigurationViewProps {
    queueId: string
}

const kindLabels: Record<string, string> = {
    traces: "Traces",
    testcases: "Test cases",
}

const COMPACT_FORM_ITEM_CLASS = "!mb-0"

// ============================================================================
// GENERAL SECTION (editable name + description)
// ============================================================================

const GeneralSection = memo(function GeneralSection({queueId}: {queueId: string}) {
    const queue = useAtomValue(simpleQueueMolecule.selectors.data(queueId))
    const isDirty = useAtomValue(simpleQueueMolecule.selectors.isDirty(queueId))
    const updateQueue = useSetAtom(simpleQueueMolecule.actions.update)
    const discardQueue = useSetAtom(simpleQueueMolecule.actions.discard)

    const kind = queue?.data?.kind
    const serverName = queue?.name ?? ""
    const serverDescription = queue?.description ?? ""

    const [editName, setEditName] = useState(serverName)
    const [editDescription, setEditDescription] = useState(serverDescription)

    // Sync local state when server data changes (e.g. after save)
    useEffect(() => {
        if (!isDirty) {
            setEditName(serverName)
            setEditDescription(serverDescription)
        }
    }, [serverName, serverDescription, isDirty])

    const hasLocalChanges = useMemo(() => {
        return editName.trim() !== serverName.trim() || editDescription !== serverDescription
    }, [editName, editDescription, serverName, serverDescription])

    const handleSave = useCallback(() => {
        updateQueue(queueId, {
            name: editName.trim(),
            description: editDescription,
        })
    }, [updateQueue, queueId, editName, editDescription])

    const handleReset = useCallback(() => {
        setEditName(serverName)
        setEditDescription(serverDescription)
        discardQueue(queueId)
    }, [discardQueue, queueId, serverName, serverDescription])

    const handleDescriptionChange = useCallback((value: string) => {
        setEditDescription(value)
    }, [])

    return (
        <SectionCard>
            <Form layout="vertical" requiredMark={false}>
                <Form.Item className={COMPACT_FORM_ITEM_CLASS} label="Name">
                    <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={100}
                        placeholder="Enter name"
                    />
                </Form.Item>

                <Form.Item
                    className={COMPACT_FORM_ITEM_CLASS}
                    label="Description"
                    style={{marginTop: 12}}
                >
                    <SharedEditor
                        initialValue={serverDescription}
                        value={editDescription}
                        placeholder="Enter description"
                        editorType="border"
                        handleChange={handleDescriptionChange}
                        editorProps={{
                            showToolbar: false,
                            showMarkdownToggleButton: true,
                            enableTokens: false,
                        }}
                    />
                </Form.Item>

                {hasLocalChanges && (
                    <div className="flex justify-end gap-2 pt-3">
                        <Button onClick={handleReset}>Reset</Button>
                        <Button type="primary" onClick={handleSave} disabled={!editName.trim()}>
                            Save
                        </Button>
                    </div>
                )}

                <Form.Item className={COMPACT_FORM_ITEM_CLASS} label="Type" style={{marginTop: 12}}>
                    {kind ? (
                        <Tag color={kind === "traces" ? "blue" : "green"}>
                            {kindLabels[kind] ?? kind}
                        </Tag>
                    ) : (
                        <EmptyValue />
                    )}
                </Form.Item>
            </Form>
        </SectionCard>
    )
})

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const ConfigurationView = memo(function ConfigurationView({queueId}: ConfigurationViewProps) {
    const queue = useAtomValue(simpleQueueMolecule.selectors.data(queueId))

    const assignments = queue?.data?.assignments
    const repeats = queue?.data?.repeats ?? 1

    if (!queue) {
        return (
            <div className="flex items-center justify-center flex-1 py-20">
                <Text type="secondary">Queue not found</Text>
            </div>
        )
    }

    return (
        <div className="flex flex-col flex-1 overflow-y-auto px-2 pb-6 bg-[var(--ant-color-bg-layout)]">
            {/* ── General ── */}
            <CollapsibleSection title="General">
                <GeneralSection queueId={queueId} />
            </CollapsibleSection>

            {/* ── Evaluators ── */}
            <CollapsibleSection title="Evaluators">
                <EvaluatorsSection />
            </CollapsibleSection>

            {/* ── Collaborator settings ── */}
            <CollapsibleSection title="Collaborator settings">
                <SectionCard>
                    <Form layout="vertical" requiredMark={false}>
                        <Form.Item label="Number of reviews per run" style={{marginBottom: 12}}>
                            <Text>{repeats}</Text>
                        </Form.Item>

                        <Form.Item label="Assignees" style={{marginBottom: 0}}>
                            {assignments && assignments.length > 0 ? (
                                <AssignmentsCell assignments={assignments} />
                            ) : (
                                <EmptyValue />
                            )}
                        </Form.Item>
                    </Form>
                </SectionCard>
            </CollapsibleSection>
        </div>
    )
})

export default ConfigurationView
