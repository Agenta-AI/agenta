/**
 * PiAutoApproveControl
 *
 * The harness "auto-approve" list: tools that run WITHOUT asking, persisted as allow-rule patterns
 * in `harness.permissions.allow`. A harness tool carries no enforceable per-tool permission, so an
 * allow-rule is the only lever; `wire_author_permission_rules` turns each entry into a runner rule
 * while `runner.permissions.default` (the Policy above) is untouched — so platform ops like
 * `commit_revision` keep gating.
 *
 * This is the panel counterpart to the approval card's "Always allow <tool>" toggle: a grant made
 * there lands here and can be removed here. It lists what was actually granted rather than a fixed
 * menu, because the patterns must match the runner's gate names VERBATIM (`bash`, `Terminal`, …),
 * which are harness/runtime-specific and not knowable up front.
 */
import {memo, useCallback, useMemo} from "react"

import {Tag, Typography} from "antd"

import {RailField, railInfoLabel} from "../../drawers/shared/RailField"

export interface PiAutoApproveControlProps {
    /** The harness `permissions` object (`harness.permissions`); may be absent. */
    value?: Record<string, unknown> | null
    /** Called with the next `harness.permissions` object. */
    onChange: (permissions: Record<string, unknown>) => void
    disabled?: boolean
}

export const PiAutoApproveControl = memo(function PiAutoApproveControl({
    value,
    onChange,
    disabled = false,
}: PiAutoApproveControlProps) {
    const allow = useMemo(() => {
        const list =
            value && typeof value === "object" && Array.isArray((value as {allow?: unknown}).allow)
                ? ((value as {allow: unknown[]}).allow as unknown[])
                : []
        return list.filter((v): v is string => typeof v === "string")
    }, [value])

    const remove = useCallback(
        (pattern: string) => {
            const base = value && typeof value === "object" ? value : {}
            onChange({...base, allow: allow.filter((entry) => entry !== pattern)})
        },
        [allow, value, onChange],
    )

    return (
        <RailField
            // The path an approval-card grant writes — so the row that changed is the row that's
            // marked when the user opens the drawer asking "what did that just change?".
            path="harness.permissions.allow"
            label={railInfoLabel(
                "Auto-approve",
                "Tools that run without asking. Added from an approval card's “Always allow”. Everything else still prompts, and commit stays gated.",
            )}
        >
            {allow.length ? (
                <div className="flex flex-wrap gap-1">
                    {allow.map((pattern) => (
                        <Tag
                            key={pattern}
                            closable={!disabled}
                            onClose={() => remove(pattern)}
                            className="!m-0 !font-mono !text-[11px]"
                        >
                            {pattern}
                        </Tag>
                    ))}
                </div>
            ) : (
                <Typography.Text type="secondary" className="!text-[11px]">
                    Nothing auto-approved — every gated tool asks each time.
                </Typography.Text>
            )}
        </RailField>
    )
})
