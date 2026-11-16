/**
 * ClaudePermissionsControl
 *
 * Layer 1 of the agent capability config, Claude-only: the Claude harness's own permission knobs.
 * These map 1:1 to Claude Code's `permissions` settings block and persist into the first-class
 * `harness.permissions` slice of the agent template (the SDK's `ClaudePermissions`,
 * agenta.sdk.agents.dtos). The shape:
 *   { default_mode?: "default"|"acceptEdits"|"plan"|"bypassPermissions",
 *     allow: string[], deny: string[], ask: string[] }
 *
 * It is rendered as a collapsed "advanced" section by AgentTemplateControl and is hidden when the
 * harness is not Claude (nothing here applies to Pi, which never gates tool use). Non-destructive:
 * an author who touches nothing leaves `harness.permissions` untouched.
 */
import {memo, useCallback, useMemo} from "react"

import {Combobox, Textarea} from "@agenta/ui/ui"

import {RailField, railInfoLabel} from "../../drawers/shared/RailField"
import {createT, useT, type CatalogKey} from "@agenta/i18n"
import permissionsCatalog from "@agenta/i18n/catalogs/entityUi.permissions"

const tNow = createT(permissionsCatalog)

type ClaudePermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"

interface ClaudePermissionsValue {
    default_mode?: ClaudePermissionMode | null
    allow?: string[]
    deny?: string[]
    ask?: string[]
}

export interface ClaudePermissionsControlProps {
    /** The `harness.permissions` value (object or null/undefined). */
    value?: Record<string, unknown> | null
    /** Called with the next permissions object. */
    onChange: (value: Record<string, unknown>) => void
    /** Disable the control */
    disabled?: boolean
    /**
     * The `default_mode` field schema (its `enum` + `title`/`description`). When provided, the mode
     * option set and the field label/description follow the template schema instead of the
     * hardcoded fallback, so a backend mode change propagates without editing this control. The enum
     * may sit directly on the node or, for an `Optional[Literal]`, inside `anyOf`.
     */
    modeSchema?: {enum?: unknown; anyOf?: unknown; title?: unknown; description?: unknown} | null
}

// FE display copy per mode value. The set of values is the schema's `default_mode` enum (passed via
// `modeSchema`); this only supplies the friendlier label, falling back to the raw value.
const MODE_OPTIONS: {value: ClaudePermissionMode; label: CatalogKey<typeof permissionsCatalog>}[] =
    [
        {value: "default", label: "entityUi.permissions.modeDefault"},
        {value: "acceptEdits", label: "entityUi.permissions.modeAcceptEdits"},
        {value: "plan", label: "entityUi.permissions.modePlan"},
        {value: "bypassPermissions", label: "entityUi.permissions.modeBypass"},
    ]

/** Read the current value, defaulting the rule lists to empty arrays. */
function readValue(value: Record<string, unknown> | null | undefined): {
    defaultMode: ClaudePermissionMode | null
    allow: string[]
    deny: string[]
    ask: string[]
} {
    const v = (value ?? {}) as ClaudePermissionsValue
    return {
        defaultMode: (v.default_mode as ClaudePermissionMode | null | undefined) ?? null,
        allow: Array.isArray(v.allow) ? v.allow : [],
        deny: Array.isArray(v.deny) ? v.deny : [],
        ask: Array.isArray(v.ask) ? v.ask : [],
    }
}

/** Split a textarea (one rule per line) into a trimmed, non-empty rule list. */
function parseRules(text: string): string[] {
    return text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
}

export const ClaudePermissionsControl = memo(function ClaudePermissionsControl({
    value,
    onChange,
    disabled = false,
    modeSchema,
}: ClaudePermissionsControlProps) {
    const t = useT(permissionsCatalog)
    const current = useMemo(() => readValue(value), [value])

    // The mode option set comes from the schema's `default_mode` enum when available (FE labels by
    // value, falling back to the raw value); otherwise the hardcoded MODE_OPTIONS. The field
    // label/description likewise prefer the schema's title/description.
    const modeOptions = useMemo(() => {
        // The enum is on the node for a bare Literal, or inside `anyOf` for an `Optional[Literal]`
        // (`anyOf: [{enum:[...]}, {type:"null"}]`).
        const direct = Array.isArray(modeSchema?.enum) ? (modeSchema!.enum as unknown[]) : null
        const fromAnyOf = Array.isArray(modeSchema?.anyOf)
            ? (modeSchema!.anyOf as {enum?: unknown}[]).find((a) => Array.isArray(a?.enum))?.enum
            : null
        const en = (direct ?? fromAnyOf) as unknown[] | null | undefined
        if (Array.isArray(en) && en.length) {
            const labelOf = (v: string) => {
                const key = MODE_OPTIONS.find((o) => o.value === v)?.label
                return key ? tNow(key) : v
            }
            return en
                .filter((v): v is string => typeof v === "string")
                .map((v) => ({value: v as ClaudePermissionMode, label: labelOf(v)}))
        }
        return MODE_OPTIONS.map((option) => ({value: option.value, label: tNow(option.label)}))
    }, [modeSchema])
    const modeLabel =
        typeof modeSchema?.title === "string" && modeSchema.title
            ? modeSchema.title
            : t("entityUi.permissions.permissionMode")
    const modeDescription =
        typeof modeSchema?.description === "string" && modeSchema.description
            ? modeSchema.description
            : t("entityUi.permissions.permissionModeHint")

    // Compose the full permissions object, overriding one slice. `default_mode` is only written
    // when set so an author who only edits rules never emits a null mode.
    const write = useCallback(
        (patch: {
            defaultMode?: ClaudePermissionMode | null
            allow?: string[]
            deny?: string[]
            ask?: string[]
        }) => {
            const next = {...current, ...patch}
            const out: Record<string, unknown> = {
                allow: next.allow,
                deny: next.deny,
                ask: next.ask,
            }
            if (next.defaultMode) out.default_mode = next.defaultMode
            onChange(out)
        },
        [current, onChange],
    )

    return (
        <>
            {/* `path` marks the row when it has an uncommitted change (see ChangedPathsProvider).
                These are the flattened dot-paths the commit-diff classifier emits for this slice —
                `harness.permissions.*` — so an approval card's "Always allow" grant (which appends
                to `allow`) marks the Allow-rules row it actually wrote to. */}
            <RailField
                label={railInfoLabel(modeLabel, modeDescription)}
                align="center"
                path="harness.permissions.default_mode"
            >
                {/* Combobox, not Select: the mode is clearable (antd `allowClear`) and Radix
                    Select has no clear affordance. */}
                <Combobox
                    value={current.defaultMode ?? undefined}
                    onChange={(v) => write({defaultMode: (v as ClaudePermissionMode) ?? null})}
                    options={modeOptions}
                    disabled={disabled}
                    placeholder={t("entityUi.permissions.claudeDefault")}
                    allowClear
                    aria-label={modeLabel}
                    className="w-full"
                />
            </RailField>

            <RailField
                path="harness.permissions.allow"
                label={railInfoLabel(
                    t("entityUi.permissions.allowRules"),
                    t("entityUi.permissions.allowRulesHint"),
                )}
            >
                <Textarea
                    value={current.allow.join("\n")}
                    onChange={(e) => write({allow: parseRules(e.target.value)})}
                    disabled={disabled}
                    placeholder={"Read\nBash(npm run:*)"}
                    rows={2}
                    aria-label={t("entityUi.permissions.allowRules")}
                    className="resize-y font-mono"
                />
            </RailField>

            <RailField
                path="harness.permissions.ask"
                label={railInfoLabel(
                    t("entityUi.permissions.askRules"),
                    t("entityUi.permissions.askRulesHint"),
                )}
            >
                <Textarea
                    value={current.ask.join("\n")}
                    onChange={(e) => write({ask: parseRules(e.target.value)})}
                    disabled={disabled}
                    placeholder="Bash(rm:*)"
                    rows={2}
                    aria-label={t("entityUi.permissions.askRules")}
                    className="resize-y font-mono"
                />
            </RailField>

            <RailField
                path="harness.permissions.deny"
                label={railInfoLabel(
                    t("entityUi.permissions.denyRules"),
                    t("entityUi.permissions.denyRulesHint"),
                )}
            >
                <Textarea
                    value={current.deny.join("\n")}
                    onChange={(e) => write({deny: parseRules(e.target.value)})}
                    disabled={disabled}
                    placeholder={"Write\nmcp__server__tool"}
                    rows={2}
                    aria-label={t("entityUi.permissions.denyRules")}
                    className="resize-y font-mono"
                />
            </RailField>
        </>
    )
})
