/**
 * ToolFormView
 *
 * Structured form view for a function tool, the Form side of {@link ConfigItemDrawer}. Edits
 * the OpenAI-style `function` shape — name, description, and a JSON-Schema `parameters` block.
 * Builtin/provider tools (a bare `type` with no editable `function`) have no meaningful form,
 * so the host renders the drawer JSON-only for those rather than this view.
 */
import {LabeledField} from "@agenta/ui/components/presentational"
import {Code} from "@phosphor-icons/react"
import {Input, Select} from "antd"

import {JsonObjectEditor} from "./JsonObjectEditor"

export interface ToolFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}

// Per-tool permission (allow / ask / deny). Stored as a TOP-LEVEL `permission` key on the tool
// object — NOT inside `agenta_metadata`, which `stripAgentaMetadataDeep` strips on every save/run.
// The SDK reads it via `AliasChoices("permission","permission_mode","permissionMode")`. Unset means
// the tool inherits the agent's global permission policy.
type ToolPermission = "allow" | "ask" | "deny"

const PERMISSION_OPTIONS: {value: ToolPermission; label: string}[] = [
    {value: "allow", label: "Allow"},
    {value: "ask", label: "Ask"},
    {value: "deny", label: "Deny"},
]

function isPermission(value: unknown): value is ToolPermission {
    return value === "allow" || value === "ask" || value === "deny"
}

/** Display default from the catalog's `read_only` metadata: true → allow, false → ask (unwritten). */
function defaultPermissionFromReadOnly(
    metadata: Record<string, unknown> | undefined,
): ToolPermission | undefined {
    const readOnly = metadata?.read_only
    if (readOnly === true) return "allow"
    if (readOnly === false) return "ask"
    return undefined
}

/** Canonical store is the top-level `permission`; fall back to a legacy `agenta_metadata.permission_mode`. */
function readPermission(
    topLevel: unknown,
    metadata: Record<string, unknown> | undefined,
): ToolPermission | undefined {
    if (isPermission(topLevel)) return topLevel
    if (isPermission(metadata?.permission_mode)) return metadata?.permission_mode
    return undefined
}

export function ToolFormView({value, onChange, disabled}: ToolFormViewProps) {
    const tool = (value ?? {}) as Record<string, unknown>
    const fn = (tool.function ?? {}) as Record<string, unknown>

    const setFn = (key: string, fieldValue: unknown) => {
        const nextFn = {...fn}
        if (fieldValue === undefined || fieldValue === null || fieldValue === "") {
            delete nextFn[key]
        } else {
            nextFn[key] = fieldValue
        }
        onChange({...tool, function: nextFn})
    }

    const metadata = tool.agenta_metadata as Record<string, unknown> | undefined
    const permission = readPermission(tool.permission, metadata)
    const permissionDefault = defaultPermissionFromReadOnly(metadata)
    const setPermission = (next: ToolPermission | null) => {
        const nextTool = {...tool}
        // Also drop the legacy `agenta_metadata.permission_mode`; otherwise clearing the
        // top-level field resolves straight back to the legacy value and "inherit policy"
        // is unreachable for older tools.
        const nextMetadata = {
            ...((nextTool.agenta_metadata as Record<string, unknown> | undefined) ?? {}),
        }
        delete nextMetadata.permission_mode
        if (Object.keys(nextMetadata).length > 0) nextTool.agenta_metadata = nextMetadata
        else delete nextTool.agenta_metadata
        if (next) nextTool.permission = next
        else delete nextTool.permission
        onChange(nextTool)
    }

    return (
        <div className="flex flex-col gap-3">
            <LabeledField label="Name">
                <Input
                    value={(fn.name as string | undefined) ?? ""}
                    onChange={(e) => setFn("name", e.target.value)}
                    placeholder="get_weather"
                    disabled={disabled}
                />
            </LabeledField>

            <LabeledField label="Description">
                <Input.TextArea
                    value={(fn.description as string | undefined) ?? ""}
                    onChange={(e) => setFn("description", e.target.value)}
                    autoSize={{minRows: 2, maxRows: 6}}
                    placeholder="What the tool does and when to use it"
                    disabled={disabled}
                />
            </LabeledField>

            <LabeledField
                label="Permission"
                description="How tool-use is gated: allow auto-approves, ask prompts the user, deny blocks. Leave unset to inherit the agent's permission policy."
                withTooltip
            >
                <Select<ToolPermission>
                    value={permission ?? undefined}
                    onChange={(v) => setPermission(v ?? null)}
                    options={PERMISSION_OPTIONS}
                    placeholder={
                        permissionDefault ? `${permissionDefault} (default)` : "Inherit policy"
                    }
                    allowClear
                    className="w-full"
                    disabled={disabled}
                />
            </LabeledField>

            <div className="flex items-start gap-2 rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] bg-[var(--ag-c-F5F7FA,#f5f7fa)] px-3 py-2 text-xs text-[var(--ag-c-586673,#586673)]">
                <Code size={14} className="mt-0.5 shrink-0" />
                <span>
                    A schema-only tool — the model emits a call and your application executes it.
                </span>
            </div>

            <LabeledField
                label="Input schema (JSON Schema)"
                description="JSON Schema describing the tool's input arguments"
                withTooltip
            >
                <JsonObjectEditor
                    value={fn.parameters ?? {}}
                    onChange={(parameters) => setFn("parameters", parameters)}
                    disabled={disabled}
                />
            </LabeledField>
        </div>
    )
}
