import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner} from "@agenta/ui/ui"

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
 * Compose the version-picker's resolved label from a revision-keyed lookup and a
 * fallback lookup, for a bound id that can't be resolved as a revision.
 *
 * `extractBoundWorkflowId` returns whatever id is most specific in the stored family —
 * a `application_revision` id, but also (when the pin never named a revision, e.g. the
 * "runs whatever the variant currently deploys" default bind) an `application_variant`
 * id. Callers resolve the primary `artifact`/`variant` names by treating that id as a
 * REVISION id; for a variant-only pin that lookup returns null, so a `fallbackArtifact`/
 * `fallbackVariant` resolved by workflow id + variant list (not a revision id) recovers
 * the label instead. `version` is omitted for a variant-only pin — it isn't pinned to one.
 */
export function composeRevisionLabel({
    artifact,
    fallbackArtifact,
    variant,
    fallbackVariant,
    version,
}: {
    artifact?: string | null
    fallbackArtifact?: string | null
    variant?: string | null
    fallbackVariant?: string | null
    version?: number | string | null
}): string | null {
    const resolvedArtifact = artifact ?? fallbackArtifact ?? null
    const resolvedVariant = variant ?? fallbackVariant ?? null
    const segs: string[] = []
    if (resolvedArtifact) segs.push(resolvedArtifact)
    if (resolvedVariant && resolvedVariant !== resolvedArtifact) segs.push(resolvedVariant)
    let label = segs.join(" / ")
    if (version != null) label = label ? `${label} · v${version}` : `v${version}`
    return label || null
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
}) {
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
                    <span className="text-xs leading-snug text-[var(--ag-colorTextDescription)]">
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
                    <span className="text-xs leading-snug text-[var(--ag-colorTextDescription)]">
                        {envHint}
                    </span>
                    <Select
                        value={environmentSlug ?? undefined}
                        onValueChange={(slug) => onEnvironmentChange?.(slug)}
                    >
                        <SelectTrigger className="w-full max-w-prose">
                            <SelectValue placeholder="Select an environment" />
                            {envLoading ? <Spinner size="small" /> : null}
                        </SelectTrigger>
                        <SelectContent>
                            {(envOptions ?? []).map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                </SelectItem>
                            ))}
                            {(envOptions ?? []).length === 0 && (
                                <div className="px-3 py-2 text-xs text-[var(--ag-colorTextDescription)]">
                                    {envNotFound ?? "No data"}
                                </div>
                            )}
                        </SelectContent>
                    </Select>
                </>
            )}
        </SectionRail>
    )
}
