/**
 * ReferenceToolFormView
 *
 * Form side of the tool {@link ConfigItemDrawer} for a `type:"reference"` workflow tool (#4860) —
 * the edit counterpart of the {@link WorkflowReferenceSelector} detail panel, so editing an existing
 * reference reads the same as adding one (instead of a raw JSON blob). Shows the exposed tool name,
 * description, and the resolved input schema (read-only, from the stored `input_schema`), plus an
 * editable "Reference by" axis (pin a variant+version, or follow a deployed environment) wired to the
 * workflow-reference bridge.
 *
 * Built from the shared pieces (`RailField`, `SchemaTree`, `RunVersionField`, `ConfigAccordionSection`);
 * dark-safe (`--ag-color*` tokens only).
 */
import {useEffect, useMemo, useState} from "react"

import {ConfigAccordionSection, CopyButton} from "@agenta/ui/components/presentational"
import {
    useDrillInUI,
    type WorkflowReferenceBridge,
    type WorkflowReferenceUI,
} from "@agenta/ui/drill-in"
import {GitBranch, Info, TreeStructure} from "@phosphor-icons/react"
import {Input, Spin} from "antd"
import {atom, useSetAtom} from "jotai"

import {RailField} from "../../drawers/shared/RailField"
import {RunVersionField} from "../../gatewayTrigger/drawers/shared/RunVersionField"
import {createWorkflowRevisionAdapter, type WorkflowRevisionSelectionResult} from "../../selection"

import {SchemaTree} from "./SchemaTree"

// Revision picker scoped to the edited reference's workflow (module-level: only one reference drawer
// is open at a time). Separate from the selector's atom so the two never collide.
const editRefWorkflowIdAtom = atom<string | null>(null)
const editReferenceRevisionAdapter = createWorkflowRevisionAdapter({
    workflowIdAtom: editRefWorkflowIdAtom,
})

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function countProps(schema: Record<string, unknown> | null): number {
    return schema && isRecord(schema.properties) ? Object.keys(schema.properties).length : 0
}

export interface ReferenceToolFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}

/**
 * The editable Reference-by axis. Isolated so the bridge hooks (`useWorkflowEnvironments`) are only
 * mounted when the bridge is available. Commits binding changes onto the reference tool immediately.
 */
function ReferenceBindingEditor({
    tool,
    onChange,
    bridge,
    workflow,
}: {
    tool: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    bridge: WorkflowReferenceBridge
    workflow: WorkflowReferenceUI | null
}) {
    const setWorkflowId = useSetAtom(editRefWorkflowIdAtom)
    useEffect(() => {
        setWorkflowId(workflow?.id ?? null)
        return () => setWorkflowId(null)
    }, [workflow?.id, setWorkflowId])

    const [bindMode, setBindMode] = useState<"revision" | "environment">(
        tool.ref_by === "environment" ? "environment" : "revision",
    )
    const [version, setVersion] = useState<string | undefined>(
        typeof tool.version === "string" ? tool.version : undefined,
    )
    const [environment, setEnvironment] = useState<string | undefined>(
        typeof tool.environment === "string" ? tool.environment : undefined,
    )
    // Selected variant id — kept even when following its latest (no pinned version).
    const [variant, setVariant] = useState<string | undefined>(
        typeof tool.variant_id === "string" ? tool.variant_id : undefined,
    )

    const {environments, isLoading} = bridge.useWorkflowEnvironments(workflow)

    // Rebuild the reference tool from the current binding, clearing the now-irrelevant axis field.
    const commit = (
        mode: "revision" | "environment",
        ver?: string,
        env?: string,
        varId?: string,
    ) => {
        const next = {...tool}
        if (mode === "revision") {
            next.ref_by = "variant"
            if (varId) next.variant_id = varId
            else delete next.variant_id
            if (ver) next.version = ver
            else delete next.version
            delete next.environment
        } else {
            next.ref_by = "environment"
            if (env) next.environment = env
            else delete next.environment
            delete next.version
            delete next.variant_id
        }
        onChange(next)
    }

    return (
        <RunVersionField
            bindMode={bindMode}
            onBindModeChange={(mode) => {
                setBindMode(mode)
                commit(mode, version, environment, variant)
            }}
            revisionAdapter={editReferenceRevisionAdapter}
            revisionPlaceholder={version ? `v${version}` : "Latest revision"}
            onRevisionSelect={(sel: WorkflowRevisionSelectionResult) => {
                const isRevision =
                    Boolean(sel.metadata.variantId) && sel.id !== sel.metadata.variantId
                const ver = isRevision ? String(sel.metadata.revision) : undefined
                const varId = sel.metadata.variantId ? String(sel.metadata.variantId) : undefined
                setVersion(ver)
                setVariant(varId)
                commit("revision", ver, environment, varId)
            }}
            revisionHint="Pin one variant + revision, or pick a variant to follow its latest."
            envOptions={environments.map((env) => ({value: env.slug, label: env.name || env.slug}))}
            envLoading={isLoading}
            environmentSlug={environment}
            onEnvironmentChange={(slug) => {
                setEnvironment(slug)
                commit("environment", version, slug)
            }}
            envNotFound={
                isLoading ? (
                    <Spin size="small" />
                ) : (
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        No environments deployed
                    </span>
                )
            }
            envHint="Calls whatever revision is deployed in the chosen environment."
        />
    )
}

/** One-line summary of the current binding (collapsed section preview + read-only fallback). */
function bindingSummary(tool: Record<string, unknown>): string {
    if (tool.ref_by === "environment") {
        return typeof tool.environment === "string"
            ? `Deployed in ${tool.environment}`
            : "A deployed environment"
    }
    return typeof tool.version === "string" ? `Pinned to v${tool.version}` : "Latest revision"
}

/** Read-only binding summary shown when the workflow-reference bridge isn't available. */
function ReadOnlyBinding({tool}: {tool: Record<string, unknown>}) {
    return <p className="m-0 text-xs text-[var(--ag-colorTextSecondary)]">{bindingSummary(tool)}</p>
}

export function ReferenceToolFormView({value, onChange, disabled}: ReferenceToolFormViewProps) {
    const tool = (value ?? {}) as Record<string, unknown>
    const slug = typeof tool.slug === "string" ? tool.slug : ""
    const description = typeof tool.description === "string" ? tool.description : ""
    const inputSchema = isRecord(tool.input_schema)
        ? (tool.input_schema as Record<string, unknown>)
        : null

    const {workflowReference} = useDrillInUI()
    const workflow = useMemo(
        () => workflowReference?.workflows.find((w) => w.slug === slug) ?? null,
        [workflowReference, slug],
    )

    const setDescription = (next: string) => onChange({...tool, description: next})

    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
            <div className="flex flex-col gap-4">
                <ConfigAccordionSection
                    size="compact"
                    collapsible={false}
                    icon={<Info size={15} />}
                    title="Details"
                >
                    <RailField label="Exposed as" align="center">
                        <div className="flex w-fit max-w-full items-center gap-1 rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] py-0.5 pl-2.5 pr-1 font-mono text-xs text-[var(--ag-colorText)]">
                            <span className="truncate">{slug}</span>
                            <CopyButton text={slug} buttonText={null} icon type="text" />
                        </div>
                    </RailField>

                    <RailField label="Description">
                        <Input.TextArea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            autoSize={{minRows: 2, maxRows: 6}}
                            placeholder="What this tool does and when the agent should call it"
                            disabled={disabled}
                        />
                    </RailField>
                </ConfigAccordionSection>

                <ConfigAccordionSection
                    size="compact"
                    icon={<TreeStructure size={15} />}
                    title="Schema"
                    summary={`Inputs · ${countProps(inputSchema)}`}
                    summaryCollapsedOnly
                >
                    <div className="max-h-[320px] max-w-prose overflow-y-auto overscroll-contain">
                        <SchemaTree schema={inputSchema} emptyText="No declared inputs" />
                    </div>
                </ConfigAccordionSection>

                <ConfigAccordionSection
                    size="compact"
                    noDivider
                    icon={<GitBranch size={15} />}
                    title="Reference by"
                    summary={bindingSummary(tool)}
                    summaryCollapsedOnly
                >
                    {workflowReference?.enabled && !disabled ? (
                        <ReferenceBindingEditor
                            tool={tool}
                            onChange={onChange}
                            bridge={workflowReference}
                            workflow={workflow}
                        />
                    ) : (
                        <ReadOnlyBinding tool={tool} />
                    )}
                </ConfigAccordionSection>
            </div>
        </div>
    )
}
