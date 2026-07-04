import {Select} from "antd"

import {SectionRail} from "../../../drawers/shared/SectionRail"
import {
    createWorkflowRevisionAdapter,
    EntityPicker,
    type WorkflowRevisionSelectionResult,
} from "../../../selection"

export type RunVersionBindMode = "revision" | "environment"

export interface TriggerReference {
    id?: string | null
    slug?: string | null
    version?: string | null
    // The reference family carries provider-specific extras; index so the assembled
    // value stays assignable to the (extra="allow") schedule/subscription data types.
    [key: string]: unknown
}
export type TriggerReferences = Record<string, TriggerReference> | null | undefined

/**
 * Assemble the `data.references` family from the run-version selection — shared by the
 * schedule and subscription save paths. Deployed → `{environment, application(slug)}`.
 * Pinned: on a fresh pick, route the picker's leaf to `application_revision` (a specific
 * revision) or `application_variant` (a variant/latest); without a re-pick, resend the
 * stored references (or a minimal variant ref). The BE completes the family either way.
 */
export function buildRunVersionReferences({
    bindMode,
    environmentSlug,
    appSlug,
    workflowSelection,
    workflowRevId,
    fallbackReferences,
}: {
    bindMode: RunVersionBindMode
    environmentSlug?: string | null
    appSlug?: string | null
    workflowSelection?: WorkflowRevisionSelectionResult | null
    workflowRevId?: string | null
    fallbackReferences?: TriggerReferences
}): TriggerReferences {
    if (bindMode === "environment") {
        return environmentSlug
            ? {
                  environment: {slug: environmentSlug},
                  ...(appSlug ? {application: {slug: appSlug}} : {}),
              }
            : undefined
    }
    const meta = workflowSelection?.metadata
    if (meta) {
        const leafId = workflowSelection?.id ?? (workflowRevId as string)
        const isRevision = !!meta.variantId && leafId !== meta.variantId
        return {
            ...(meta.workflowId ? {application: {id: meta.workflowId}} : {}),
            ...(isRevision
                ? {application_revision: {id: leafId}}
                : {application_variant: {id: meta.variantId || leafId}}),
        }
    }
    return fallbackReferences ?? {application_variant: {id: workflowRevId as string}}
}

/**
 * Shared "Which version runs?" control for the trigger drawers (schedule + subscription):
 * a Pinned/Deployed rail on the left, and on the right either a workflow-revision picker
 * (pinned) or an environment select (deployed). Purely presentational — each drawer owns
 * the bind state and feeds the resulting reference into its save body (see
 * `buildRunVersionReferences`).
 */
export function RunVersionField({
    bindMode,
    onBindModeChange,
    revisionAdapter,
    revisionPlaceholder,
    onRevisionSelect,
    revisionHint = "Runs one exact variant + revision.",
    envOptions,
    envLoading,
    environmentSlug,
    onEnvironmentChange,
    envNotFound,
    envHint = "Follows the revision deployed to an environment.",
    railWidth = "w-[116px]",
}: {
    bindMode: RunVersionBindMode
    onBindModeChange: (mode: RunVersionBindMode) => void
    revisionAdapter: ReturnType<typeof createWorkflowRevisionAdapter>
    revisionPlaceholder?: string
    onRevisionSelect: (selection: WorkflowRevisionSelectionResult) => void
    revisionHint?: string
    envOptions: {value: string; label: string}[]
    envLoading?: boolean
    environmentSlug?: string | null
    onEnvironmentChange: (slug: string) => void
    envNotFound?: React.ReactNode
    envHint?: string
    /** Left-rail width (Tailwind class). Override to align with a sibling section's rail. */
    railWidth?: string
}) {
    return (
        <SectionRail
            items={[
                {value: "revision", label: "Pinned"},
                {value: "environment", label: "Deployed"},
            ]}
            value={bindMode}
            onChange={(v) => onBindModeChange(v as RunVersionBindMode)}
            railWidth={railWidth}
        >
            {bindMode === "revision" ? (
                <>
                    <span className="!text-[11px] leading-snug text-muted-foreground">
                        {revisionHint}
                    </span>
                    <EntityPicker<WorkflowRevisionSelectionResult>
                        variant="popover-cascader"
                        adapter={revisionAdapter}
                        onSelect={onRevisionSelect}
                        className="!flex w-full max-w-prose !justify-between"
                        placeholder={revisionPlaceholder}
                    />
                </>
            ) : (
                <>
                    <span className="!text-[11px] leading-snug text-muted-foreground">
                        {envHint}
                    </span>
                    <Select
                        placeholder="Select an environment"
                        className="w-full max-w-prose"
                        value={environmentSlug ?? undefined}
                        onChange={onEnvironmentChange}
                        loading={envLoading}
                        options={envOptions}
                        notFoundContent={envNotFound}
                    />
                </>
            )}
        </SectionRail>
    )
}
