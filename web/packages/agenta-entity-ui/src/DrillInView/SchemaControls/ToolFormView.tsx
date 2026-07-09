/**
 * ToolFormView
 *
 * Structured Form side of the tool {@link ConfigItemDrawer} for a schema-only `function` tool. A
 * two-panel master/detail: the left {@link ParameterTree} rail is the tool's JSON-Schema parameters;
 * the right panel is contextual — the {@link ParameterNodeEditor} for the selected parameter, or the
 * tool **basics** (name / description / permission) while nothing is selected, so the drawer never
 * opens blank and the tool name is the first thing seen. The drawer's JSON toggle stays the lossless
 * escape hatch for shapes the form can't express (enums, unions, tuples).
 *
 * Built to match the sibling drawers (WorkflowReferenceSelector, trigger drawers): 240px rail with a
 * right border, independent scroll, shared `RowRemoveButton`, semantic `--ag-color*` tokens (dark-safe).
 */
import {useMemo, useState} from "react"

import {useToolActionDetail, type ToolCatalogActionDetails} from "@agenta/entities/gatewayTool"
import {buildGatewayToolSlug, safeStringify} from "@agenta/shared/utils"
import {Code, WarningCircle} from "@phosphor-icons/react"
import {Input, Select, Spin, Switch} from "antd"

import {RailField} from "../../drawers/shared/RailField"

import {ParameterNodeEditor} from "./agentTemplate/ParameterNodeEditor"
import {ParameterTree} from "./agentTemplate/ParameterTree"
import {
    addPropertyAt,
    getNodeAt,
    getProps,
    isRecord,
    removeNodeAt,
    type Schema,
    type Seg,
} from "./agentTemplate/schemaPaths"
import {ReferenceToolFormView} from "./ReferenceToolFormView"
import {parseGatewayFunctionName, parseGatewayTool, type ParsedGatewayTool} from "./toolUtils"

export interface ToolFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}

// Per-tool permission is stored as a top-level `permission` key; unset inherits the runner policy.
type ToolPermission = "allow" | "ask" | "deny"
type ToolPermissionSelection = ToolPermission | "inherit"

const PERMISSION_OPTIONS: {value: ToolPermissionSelection; label: string}[] = [
    {value: "allow", label: "Allow"},
    {value: "ask", label: "Ask"},
    {value: "deny", label: "Deny"},
    {value: "inherit", label: "Inherit"},
]

function isPermission(value: unknown): value is ToolPermission {
    return value === "allow" || value === "ask" || value === "deny"
}

function readPermission(topLevel: unknown): ToolPermission | undefined {
    return isPermission(topLevel) ? topLevel : undefined
}

/** Tool basics — shown in the detail panel while no parameter node is selected. */
function ToolBasics({
    tool,
    onChange,
    disabled,
}: {
    tool: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}) {
    const fn = (tool.function ?? {}) as Record<string, unknown>
    const setFn = (fieldKey: string, fieldValue: unknown) => {
        const nextFn = {...fn}
        if (fieldValue === undefined || fieldValue === null || fieldValue === "") {
            delete nextFn[fieldKey]
        } else {
            nextFn[fieldKey] = fieldValue
        }
        onChange({...tool, function: nextFn})
    }

    // `additionalProperties` on the parameters object: off (false) means only the listed params
    // are accepted; on (true) allows extra keys. Undefined is treated as off.
    const params = isRecord(fn.parameters) ? (fn.parameters as Record<string, unknown>) : {}
    const additionalProperties = params.additionalProperties === true
    const setAdditionalProperties = (on: boolean) => {
        onChange({...tool, function: {...fn, parameters: {...params, additionalProperties: on}}})
    }

    const permission = readPermission(tool.permission)
    const setPermission = (next: ToolPermissionSelection) => {
        const nextTool = {...tool}
        if (next === "inherit") delete nextTool.permission
        else nextTool.permission = next
        onChange(nextTool)
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                Tool details
            </div>

            <div className="flex flex-col gap-3">
                <RailField label="Name" align="center">
                    <Input
                        value={(fn.name as string | undefined) ?? ""}
                        onChange={(e) => setFn("name", e.target.value)}
                        placeholder="get_weather"
                        disabled={disabled}
                    />
                </RailField>

                <RailField label="Description">
                    <Input.TextArea
                        value={(fn.description as string | undefined) ?? ""}
                        onChange={(e) => setFn("description", e.target.value)}
                        autoSize={{minRows: 2, maxRows: 6}}
                        placeholder="What the tool does and when to use it"
                        disabled={disabled}
                    />
                </RailField>

                <RailField label="Permission" align="center">
                    <Select<ToolPermissionSelection>
                        value={permission ?? "inherit"}
                        onChange={setPermission}
                        options={PERMISSION_OPTIONS}
                        className="w-full"
                        disabled={disabled}
                    />
                </RailField>

                <RailField label="Allow extra properties" align="center">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={additionalProperties}
                            onChange={setAdditionalProperties}
                            disabled={disabled}
                        />
                        <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                            {additionalProperties
                                ? "Inputs may include keys not listed above."
                                : "Only the listed parameters are accepted."}
                        </span>
                    </div>
                </RailField>
            </div>

            {(() => {
                // A connected-app tool with no parameters means its provider input schema couldn't
                // be loaded — say so, and prompt the user to define the inputs (instead of the
                // generic schema-only hint that reads oddly for a fetched app tool).
                const gateway = parseGatewayFunctionName(fn.name as string | undefined)
                const noParams = Object.keys(getProps(params as Schema)).length === 0
                if (gateway && noParams) {
                    return (
                        <div className="flex items-start gap-2 rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] px-3 py-2 text-xs text-[var(--ag-colorWarningText)]">
                            <Code
                                size={14}
                                className="mt-0.5 shrink-0 text-[var(--ag-colorWarning)]"
                            />
                            <span>
                                Couldn&apos;t load {gateway.integration}&apos;s input schema for
                                this action. Add the parameters it expects on the left (or paste
                                them via JSON) so the model knows what to send.
                            </span>
                        </div>
                    )
                }
                return (
                    <div className="flex items-start gap-2 rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] px-3 py-2 text-xs text-[var(--ag-colorTextSecondary)]">
                        <Code size={14} className="mt-0.5 shrink-0" />
                        <span>
                            A schema-only tool — the model emits a call and your application
                            executes it. Define the inputs it provides in the parameters on the
                            left.
                        </span>
                    </div>
                )
            })()}
        </div>
    )
}

/** Normalize a catalog input schema into the object schema the form/runner expect (mirrors the
 *  add drawer's normalizeParameters, so a resolved canonical tool matches a UI-added one). */
function normalizeParameters(inputs: unknown): Record<string, unknown> {
    if (!isRecord(inputs)) {
        return {type: "object", properties: {}, required: [], additionalProperties: false}
    }
    const schema = {...(inputs as Record<string, unknown>)}
    if (schema.type !== "object") schema.type = "object"
    if (!isRecord(schema.properties)) schema.properties = {}
    if (!Array.isArray(schema.required)) schema.required = []
    if (typeof schema.additionalProperties !== "boolean") schema.additionalProperties = false
    return schema
}

/**
 * The canonical `{type:"gateway",…}` object persists no name/description/schema (the catalog is
 * authoritative; the runner re-enriches at run time). To render its drill-in **pixel-identical** to
 * a legacy UI-added gateway tool, we fetch the catalog detail and feed {@link FunctionToolForm} the
 * exact legacy function shape the drawer would have written. Nothing is persisted unless the user
 * edits. Fail-safe: an action/connection that can't be resolved falls back to today's raw-JSON view
 * plus a warning (the drawer's JSON toggle stays the editable escape hatch).
 */
function CanonicalGatewayToolForm({
    value,
    view,
    onChange,
    disabled,
}: {
    value: Record<string, unknown>
    view: ParsedGatewayTool
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}) {
    const {action, isLoading} = useToolActionDetail(view.integration, view.action)
    const resolved = !isLoading && !!action
    const legacyValue = useMemo(() => {
        if (!resolved || !action) return null
        const details = "schemas" in action ? (action as ToolCatalogActionDetails) : null
        return {
            type: "function",
            function: {
                name: buildGatewayToolSlug(
                    view.provider,
                    view.integration,
                    view.action,
                    view.connection,
                ),
                description: action.description || action.name || action.key || "",
                parameters: normalizeParameters(details?.schemas?.inputs),
            },
            ...(view.permission ? {permission: view.permission} : {}),
        } as Record<string, unknown>
    }, [resolved, action, view])

    if (isLoading) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center py-8">
                <Spin />
            </div>
        )
    }
    if (!legacyValue) {
        // Fail-safe: the tool can't be resolved (renamed/removed action or connection). Show today's
        // raw JSON plus a warning; the drawer's JSON toggle stays the editable view.
        return (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
                <div className="flex items-start gap-2 rounded border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2 text-xs text-[var(--ag-colorWarningText)]">
                    <WarningCircle
                        size={14}
                        className="mt-0.5 shrink-0 text-[var(--ag-colorWarning)]"
                    />
                    <span>
                        Couldn&apos;t resolve this tool. The action or connection may have been
                        renamed or removed. Use the JSON view to inspect the raw tool.
                    </span>
                </div>
                <pre className="m-0 overflow-auto rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] p-2 font-mono text-[11px] text-[var(--ag-colorTextSecondary)]">
                    {safeStringify(value)}
                </pre>
            </div>
        )
    }
    return <FunctionToolForm value={legacyValue} onChange={onChange} disabled={disabled} />
}

export function ToolFormView({value, onChange, disabled}: ToolFormViewProps) {
    const tool = (value ?? {}) as Record<string, unknown>
    // A workflow-reference tool has no editable `function` — it gets its own detail view (exposed
    // name / schema / reference-by), the edit counterpart of the WorkflowReferenceSelector.
    if (tool.type === "reference") {
        return <ReferenceToolFormView value={tool} onChange={onChange} disabled={disabled} />
    }
    // A canonical gateway object carries no `function`, so it can't feed the form directly. Resolve it
    // against the catalog and render it exactly like a legacy gateway tool. A legacy gateway tool is a
    // function tool and flows through the normal form below UNCHANGED.
    const gateway = parseGatewayTool(tool)
    if (gateway?.encoding === "canonical") {
        return (
            <CanonicalGatewayToolForm
                value={tool}
                view={gateway}
                onChange={onChange}
                disabled={disabled}
            />
        )
    }
    return <FunctionToolForm value={tool} onChange={onChange} disabled={disabled} />
}

function FunctionToolForm({value, onChange, disabled}: ToolFormViewProps) {
    const tool = (value ?? {}) as Record<string, unknown>
    const fn = (tool.function ?? {}) as Record<string, unknown>
    const parameters: Schema = isRecord(fn.parameters) ? (fn.parameters as Schema) : {}

    // Selected parameter node (null → show tool basics). Local; the drawer remounts per item.
    const [selectedPath, setSelectedPath] = useState<Seg[] | null>(null)

    const setParameters = (next: Schema) => onChange({...tool, function: {...fn, parameters: next}})

    const handleAddRoot = () => {
        const {schema, key} = addPropertyAt(parameters, [])
        setParameters(schema)
        setSelectedPath([{p: key}])
    }

    const handleAddProperty = (parentPath: Seg[]) => {
        const {schema, key} = addPropertyAt(parameters, parentPath)
        setParameters(schema)
        setSelectedPath([...parentPath, {p: key}])
    }

    const handleRemove = (parentPath: Seg[], key: string) => {
        const next = removeNodeAt(parameters, parentPath, key)
        setParameters(next)
        // Drop the selection if the removed node was (an ancestor of) what was selected.
        if (selectedPath && getNodeAt(next, selectedPath) === null) setSelectedPath(null)
    }

    const selectionValid = selectedPath != null && getNodeAt(parameters, selectedPath) !== null

    return (
        <div className="flex min-h-0 flex-1">
            <ParameterTree
                schema={parameters}
                selectedPath={selectionValid ? selectedPath : null}
                onSelect={setSelectedPath}
                metaSelected={!selectionValid}
                onSelectMeta={() => setSelectedPath(null)}
                onAddRoot={handleAddRoot}
                onAddProperty={handleAddProperty}
                onRemove={handleRemove}
                disabled={disabled}
            />

            <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4">
                {selectionValid && selectedPath ? (
                    <ParameterNodeEditor
                        schema={parameters}
                        path={selectedPath}
                        onChange={setParameters}
                        onPathChange={setSelectedPath}
                        onAddChild={handleAddProperty}
                        disabled={disabled}
                    />
                ) : (
                    <ToolBasics tool={tool} onChange={onChange} disabled={disabled} />
                )}
            </div>
        </div>
    )
}
