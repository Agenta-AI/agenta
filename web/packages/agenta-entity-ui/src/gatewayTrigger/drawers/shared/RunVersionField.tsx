import {Select, Typography} from "antd"

import {SectionRail} from "../../../drawers/shared/SectionRail"
import {
    createWorkflowRevisionAdapter,
    EntityPicker,
    type WorkflowRevisionSelectionResult,
} from "../../../selection"

import {VersionHistorySelect, type VersionHistorySelection} from "./VersionHistorySelect"

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

// Every key a pinned binding can live under, family by family and most specific first —
// mirrors the prefix scan in `triggers/service.py::_validate_references`.
const BIND_KEYS = ["application", "evaluator", "workflow"].flatMap((prefix) => [
    `${prefix}_revision`,
    `${prefix}_variant`,
    prefix,
])

/** First bind key whose ref satisfies `ok`. Both predicates below share this one table. */
function findBoundRef(
    references: TriggerReferences,
    ok: (ref: TriggerReference) => boolean,
): TriggerReference | null {
    if (!references) return null
    for (const key of BIND_KEYS) {
        const ref = references[key]
        if (ref && ok(ref)) return ref
    }
    return null
}

/**
 * Does this stored family already pin a workflow? The picker only understands a leaf
 * REVISION id, but the backend accepts more: an artifact or variant with no revision
 * ("resolve latest at trigger time"), and refs keyed by `slug` instead of `id`. Those
 * bindings can't fill the picker, so the save guard asks this instead of `!workflowRevId`
 * — otherwise editing an unrelated field on a validly-bound trigger is refused.
 * A deployed family is excluded: it carries `application.slug` but is not a pin, and
 * treating it as one would let Pinned save while silently resending the environment ref.
 */
export function hasBoundWorkflow(references: TriggerReferences): boolean {
    if (references?.environment) return false
    return !!findBoundRef(references, (ref) => !!ref.id || !!ref.slug)
}

/**
 * The bound id the picker and the workflow molecule can resolve, most specific first.
 * Artifact-level ids are included so an artifact-only binding still labels itself; a
 * slug-only binding has no id and stays null (see {@link hasBoundWorkflow}).
 */
export function extractBoundWorkflowId(references: TriggerReferences): string | null {
    return findBoundRef(references, (ref) => !!ref.id)?.id ?? null
}

export interface BoundVersion {
    /** "latest" = a variant/bare binding (tracks newest); "revision" = a pinned point. */
    kind: "latest" | "revision"
    /** Revision id when kind is "revision" (molecule-resolvable to a vN); null for latest. */
    revisionId: string | null
}

/**
 * Classify a stored binding as agent "History": a `*_revision` ref is a pinned `vN`
 * (its id resolves to a version); a `*_variant` or bare ref tracks the latest. Deployed
 * (environment) is not a version binding. Used for the drawer label and the card chip so
 * both read in the agent vocabulary — "Latest" / "v5" — instead of an unresolved id.
 */
export function extractBoundVersion(references: TriggerReferences): BoundVersion | null {
    if (!references || references.environment) return null
    for (const prefix of ["application", "evaluator", "workflow"]) {
        const revision = references[`${prefix}_revision`]
        if (revision && (revision.id || revision.slug)) {
            return {kind: "revision", revisionId: revision.id ?? null}
        }
        const variant = references[`${prefix}_variant`]
        if (variant && (variant.id || variant.slug)) return {kind: "latest", revisionId: null}
        const bare = references[prefix]
        if (bare && (bare.id || bare.slug)) return {kind: "latest", revisionId: null}
    }
    return null
}

/**
 * Is the run-version section answered? Pinned counts the picker's leaf OR a stored pin the
 * picker can't display; Deployed needs an environment. The save guard and the section
 * header must agree — if they drift, the header reads complete while save refuses.
 */
export function isRunVersionBound({
    bindMode,
    workflowRevId,
    environmentSlug,
    storedReferences,
}: {
    bindMode: RunVersionBindMode
    workflowRevId?: string | null
    environmentSlug?: string | null
    storedReferences?: TriggerReferences
}): boolean {
    if (bindMode === "environment") return !!environmentSlug
    return !!workflowRevId || hasBoundWorkflow(storedReferences)
}

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
    hideEnvironment = false,
    envOptions,
    envLoading,
    environmentSlug,
    onEnvironmentChange,
    envNotFound,
    envHint = "Follows the revision deployed to an environment.",
    railWidth = "w-[116px]",
    historyMode = false,
    historyVariantId,
    historyValue,
    onHistorySelect,
}: {
    bindMode: RunVersionBindMode
    onBindModeChange: (mode: RunVersionBindMode) => void
    revisionAdapter: ReturnType<typeof createWorkflowRevisionAdapter>
    revisionPlaceholder?: string
    onRevisionSelect: (selection: WorkflowRevisionSelectionResult) => void
    revisionHint?: string
    /** TEMPORARY: drop the Deployed option, leaving a Pinned-only rail. Set by the trigger
     *  drawers; the tool "Reference by" control still offers both. */
    hideEnvironment?: boolean
    envOptions?: {value: string; label: string}[]
    envLoading?: boolean
    environmentSlug?: string | null
    onEnvironmentChange?: (slug: string) => void
    envNotFound?: React.ReactNode
    envHint?: string
    /** Left-rail width (Tailwind class). Override to align with a sibling section's rail. */
    railWidth?: string
    /** Agent playground: replace the variant→revision picker (and the Pinned/Deployed rail)
     *  with a flat "History" dropdown — Latest + vN. Off elsewhere, so settings / evaluator
     *  flows keep the full EntityPicker unchanged. */
    historyMode?: boolean
    historyVariantId?: string | null
    historyValue?: string | null
    onHistorySelect?: (selection: VersionHistorySelection) => void
}) {
    // Agent History mode: a single flat version list, no bind-mode rail (Latest replaces
    // "Pinned", Deployed is not offered for agents).
    if (historyMode) {
        return (
            <div className="flex flex-col gap-1.5">
                <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                    Runs the newest version, or pin one from history.
                </Typography.Text>
                <VersionHistorySelect
                    variantId={historyVariantId ?? null}
                    value={historyValue ?? null}
                    onSelect={(selection) => onHistorySelect?.(selection)}
                    placeholder={revisionPlaceholder}
                />
            </div>
        )
    }
    return (
        <SectionRail
            items={[
                {value: "revision", label: "Pinned"},
                ...(hideEnvironment ? [] : [{value: "environment", label: "Deployed"}]),
            ]}
            value={bindMode}
            onChange={(v) => onBindModeChange(v as RunVersionBindMode)}
            railWidth={railWidth}
        >
            {bindMode === "revision" || hideEnvironment ? (
                <>
                    <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                        {revisionHint}
                    </Typography.Text>
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
                    <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                        {envHint}
                    </Typography.Text>
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
