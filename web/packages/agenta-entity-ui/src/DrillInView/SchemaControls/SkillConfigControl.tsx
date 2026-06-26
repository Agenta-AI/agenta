/**
 * SkillConfigControl
 *
 * Schema-driven control for one declared skill on the agent config. Skills are a sibling of
 * `tools` and `mcp_servers`: each entry is either an inline SKILL.md package (`name`,
 * `description`, `body`, optional bundled `files`, and the two behavior flags) or an
 * `@ag.embed` reference to a stored skill the backend inlines into that same shape before the
 * runner sees it. The shape is open enough that a JSON editor is the pragmatic v1 — the same
 * approach McpServerItemControl takes for MCP servers — with a name header and a delete control.
 * The typed shape lives in the `skill_config` catalog type (SkillConfigSchema in the SDK); this
 * control just edits one entry of the `skills` array.
 *
 * The full inline-authoring form (separate fields per file, an upload affordance) is out of
 * scope; the JSON editor keeps both inline skills and `@ag.embed` references editable and, more
 * importantly, preserves an `@ag.embed` object intact on round-trip (it parses and re-serializes
 * the object as-is, so the embed markers survive).
 */
import {memo, useCallback, useEffect, useRef, useState} from "react"

import {isPlainObject, safeStringify} from "@agenta/shared/utils"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {MinusCircle} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"
import clsx from "clsx"

export interface SkillConfigControlProps {
    /** Skill value (object or JSON string). An inline package or an `@ag.embed` reference. */
    value: unknown
    /** Called when the skill value changes (only on valid JSON) */
    onChange?: (value: Record<string, unknown>) => void
    /** Called when the skill should be removed */
    onDelete?: () => void
    /** Whether the control is read-only */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
}

function toSkillObj(value: unknown): Record<string, unknown> {
    try {
        if (typeof value === "string") {
            const parsed = value ? JSON.parse(value) : {}
            return isPlainObject(parsed) ? parsed : {}
        }
        if (isPlainObject(value)) return value
    } catch {
        // fall through to empty object
    }
    return {}
}

/** An `@ag.embed` reference entry carries the embed marker at its top level. */
export function isEmbedRef(skill: Record<string, unknown>): boolean {
    return "@ag.embed" in skill
}

/** The reserved slug namespace for platform-owned skills (mirrors the backend `_agenta.*`). */
const PLATFORM_SLUG_PREFIX = "_agenta."

function asObj(value: unknown): Record<string, unknown> | undefined {
    return isPlainObject(value) ? value : undefined
}

/**
 * The slug an embed entry points at, read from either a `workflow` or a pinned
 * `workflow_revision` reference under `@ag.embed > @ag.references`. Returns `undefined` for an
 * inline (non-embed) entry or an embed without a slug.
 */
export function platformEmbedSlug(skill: Record<string, unknown>): string | undefined {
    const refs = asObj(asObj(skill["@ag.embed"])?.["@ag.references"])
    if (!refs) return undefined
    const workflowSlug = asObj(refs.workflow)?.slug
    const revisionSlug = asObj(refs.workflow_revision)?.slug
    const slug = workflowSlug ?? revisionSlug
    return typeof slug === "string" ? slug : undefined
}

/** A pinned revision's version, when the embed references a `workflow_revision`. */
function embedRevisionVersion(skill: Record<string, unknown>): string | undefined {
    const refs = asObj(asObj(skill["@ag.embed"])?.["@ag.references"])
    const version = asObj(refs?.workflow_revision)?.version
    return typeof version === "string" ? version : undefined
}

/**
 * Whether a skill entry is platform-owned and so read-only for the author. The reliable
 * client-side signal is the reserved `_agenta.` slug prefix on the embed's referenced workflow (or
 * pinned workflow_revision); a resolved object carrying `flags.is_platform === true` counts too.
 */
export function isPlatformSkill(skill: Record<string, unknown>): boolean {
    const slug = platformEmbedSlug(skill)
    if (slug && slug.startsWith(PLATFORM_SLUG_PREFIX)) return true
    return asObj(skill.flags)?.is_platform === true
}

/**
 * Parse the editor's JSON text into a skill entry, or `null` when it does not parse to a plain
 * object (kept invalid in the editor, not propagated). Re-serializes the object as-is, so an
 * `@ag.embed` reference — including its `@ag.references` / `@ag.selector` markers — survives the
 * round-trip intact. Extracted so the preservation guarantee is unit-testable without a React
 * harness.
 */
export function parseSkillEditorText(text: string): Record<string, unknown> | null {
    try {
        const parsed = text ? JSON.parse(text) : {}
        return isPlainObject(parsed) ? parsed : null
    } catch {
        return null
    }
}

/** Header label for a skill entry: its `name`, or a generic label for an embed/empty entry. */
function skillLabel(skill: Record<string, unknown>): string {
    if (typeof skill.name === "string" && skill.name) return skill.name
    if (isEmbedRef(skill)) return "Skill reference"
    return "Skill"
}

export const SkillConfigControl = memo(function SkillConfigControl({
    value,
    onChange,
    onDelete,
    disabled = false,
    className,
}: SkillConfigControlProps) {
    const {SharedEditor} = useDrillInUI()
    const skillObj = toSkillObj(value)
    const name = skillLabel(skillObj)
    const embed = isEmbedRef(skillObj)
    const platform = isPlatformSkill(skillObj)

    const [editorText, setEditorText] = useState<string>(() => safeStringify(skillObj ?? {}))

    // Reset the editor text when the value changes from outside (add/remove/reorder).
    const lastExternalRef = useRef<string>(safeStringify(skillObj ?? {}))
    useEffect(() => {
        const next = safeStringify(toSkillObj(value) ?? {})
        if (next !== lastExternalRef.current) {
            lastExternalRef.current = next
            setEditorText(next)
        }
    }, [value])

    const handleEditorChange = useCallback(
        (text: string) => {
            if (disabled) return
            setEditorText(text)
            // Round-trips the object as-is, so an `@ag.embed` reference is preserved intact.
            // Invalid / non-object text stays in the editor and is not propagated.
            const parsed = parseSkillEditorText(text)
            if (parsed === null) return
            lastExternalRef.current = safeStringify(parsed)
            onChange?.(parsed)
        },
        [disabled, onChange],
    )

    const header = (
        <div className="w-full flex items-center justify-between gap-2 py-1">
            <div className="flex items-center gap-2 min-w-0">
                <Typography.Text strong className="text-sm truncate">
                    {name}
                </Typography.Text>
                {embed && <Tag color="blue">@ag.embed</Tag>}
            </div>
            {!disabled && onDelete && (
                <Tooltip title="Remove">
                    <Button
                        icon={<MinusCircle size={14} />}
                        type="text"
                        size="small"
                        onClick={onDelete}
                        className="invisible group-hover/skill:visible shrink-0"
                    />
                </Tooltip>
            )}
        </div>
    )

    // A platform-owned skill is a default the author cannot edit or remove: render it read-only,
    // with no JSON/body editor and no delete control (the embed and its body stay untouched).
    if (platform) {
        const slug = platformEmbedSlug(skillObj)
        const version = embedRevisionVersion(skillObj)
        return (
            <div
                className={clsx(
                    "group/skill flex flex-col gap-1 border rounded-lg p-3 w-full max-w-full",
                    className,
                )}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <Typography.Text strong className="text-sm truncate">
                        {name}
                    </Typography.Text>
                    <Tag color="default">Platform skill</Tag>
                    {version && <Tag color="default">{version}</Tag>}
                </div>
                {slug && (
                    <Typography.Text type="secondary" className="text-xs font-mono truncate">
                        {slug}
                    </Typography.Text>
                )}
                <Typography.Text type="secondary" className="text-xs">
                    Provided by Agenta. This skill cannot be edited or removed.
                </Typography.Text>
            </div>
        )
    }

    if (!SharedEditor) {
        return (
            <div
                className={clsx("group/skill flex flex-col gap-2 border rounded-lg p-3", className)}
            >
                {header}
                <textarea
                    className="font-mono text-xs p-2 border rounded min-h-[120px] resize-y w-full"
                    value={editorText}
                    onChange={(e) => handleEditorChange(e.target.value)}
                    readOnly={disabled}
                />
            </div>
        )
    }

    return (
        <div className={clsx("group/skill flex flex-col w-full max-w-full", className)}>
            <SharedEditor
                initialValue={editorText}
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: true,
                    noProvider: true,
                }}
                handleChange={handleEditorChange}
                noProvider
                disableDebounce
                syncWithInitialValueChanges
                editorType="border"
                state={disabled ? "readOnly" : "filled"}
                header={header}
            />
        </div>
    )
})
