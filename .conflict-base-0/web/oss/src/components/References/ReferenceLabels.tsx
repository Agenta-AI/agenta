import {memo, useMemo} from "react"

import {getWorkflowTypeColor, workflowMolecule} from "@agenta/entities/workflow"
import {Skeleton, Typography} from "antd"
import type {TooltipPlacement} from "antd/es/tooltip"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {latestRevisionForTestsetAtomFamily, revision} from "@/oss/state/entities/testset"

import {
    appReferenceAtomFamily,
    evaluatorReferenceAtomFamily,
    environmentReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
    queryReferenceAtomFamily,
} from "./atoms/entityReferences"
import type {ReferenceTone} from "./referenceColors"
import ReferenceTag from "./ReferenceTag"

const {Text} = Typography

/**
 * Generic testset tag that fetches and displays a testset reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 * If revisionId is provided, the link will point to the specific revision.
 */
export const TestsetTag = memo(
    ({
        testsetId,
        revisionId,
        projectId,
        projectURL,
        toneOverride,
        showIconOverride,
        openExternally = false,
        hovercardPlacement,
    }: {
        testsetId: string
        revisionId?: string | null
        projectId: string | null
        projectURL?: string | null
        toneOverride?: ReferenceTone | null
        showIconOverride?: boolean
        openExternally?: boolean
        hovercardPlacement?: TooltipPlacement
    }) => {
        const queryAtom = useMemo(
            () => previewTestsetReferenceAtomFamily({projectId, testsetId}),
            [projectId, testsetId],
        )
        const query = useAtomValue(queryAtom)

        // Fetch revision entity to get version number (must be called before any early returns)
        const revisionDataAtom = useMemo(
            () => revision.selectors.data(revisionId ?? ""),
            [revisionId],
        )
        const revisionEntity = useAtomValue(revisionDataAtom)
        const revisionVersion = revisionId ? revisionEntity?.version : null

        // Get latest revision for testset (used when revisionId is not provided)
        const latestRevisionAtom = useMemo(
            () => latestRevisionForTestsetAtomFamily(testsetId),
            [testsetId],
        )
        const latestRevision = useAtomValue(latestRevisionAtom)

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 160}} />
        }

        const ref = query.data
        // If we have an ID but no name, or query errored, the testset was likely deleted
        const isDeleted = Boolean(query.isError || (ref?.id && !ref?.name))
        const label = isDeleted ? "Deleted" : (ref?.name ?? ref?.id ?? testsetId)
        // Don't show link for deleted testsets
        // Use revision ID for URL if available, then try latest revision, finally fall back to testset ID
        // For old evaluations without revision info, we use testset ID which the page should handle
        const targetId = revisionId ?? latestRevision?.id ?? testsetId
        const href = isDeleted ? null : projectURL ? `${projectURL}/testsets/${targetId}` : null

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Testset ${testsetId} was deleted` : undefined}
                copyValue={testsetId}
                className="max-w-[220px] w-fit"
                tone={toneOverride === null ? undefined : (toneOverride ?? "testset")}
                entityKind="testset"
                identifiers={{
                    name: label,
                    id: testsetId,
                    version: revisionVersion,
                    revisionId: revisionId ?? null,
                }}
                deleted={isDeleted}
                showIcon={showIconOverride ?? true}
                openExternally={openExternally}
                hovercardPlacement={hovercardPlacement}
            />
        )
    },
)

/**
 * Generic environment reference label that fetches and displays an environment reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const EnvironmentReferenceLabel = memo(
    ({
        environmentId,
        environmentSlug,
        projectId,
        applicationId,
        projectURL,
        href: explicitHref,
        openExternally = false,
        label: customLabel,
        hovercardPlacement,
    }: {
        environmentId?: string | null
        environmentSlug?: string | null
        projectId: string | null
        applicationId?: string | null
        projectURL?: string | null
        href?: string | null
        openExternally?: boolean
        label?: string
        hovercardPlacement?: TooltipPlacement
    }) => {
        const queryAtom = useMemo(
            () =>
                environmentReferenceAtomFamily({
                    projectId,
                    applicationId,
                    environmentId,
                    environmentSlug,
                }),
            [projectId, applicationId, environmentId, environmentSlug],
        )
        const query = useAtomValue(queryAtom)

        if (!environmentId && !environmentSlug) {
            if (customLabel) {
                return (
                    <ReferenceTag
                        label={customLabel}
                        className="max-w-[220px] w-fit"
                        tone="environment"
                    />
                )
            }
            return <Text type="secondary">—</Text>
        }

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const isDeleted = Boolean(
            query.isError ||
            ((environmentId || environmentSlug) && !ref?.name && !ref?.slug && !ref?.id),
        )
        const label = isDeleted
            ? "Deleted"
            : (ref?.name ??
              ref?.slug ??
              customLabel ??
              ref?.id ??
              environmentSlug ??
              environmentId ??
              "Environment")
        const resolvedSlug = ref?.slug ?? ref?.name ?? environmentSlug ?? null
        const targetAppId = ref?.appId ?? applicationId ?? null
        const href = isDeleted
            ? null
            : (explicitHref ??
              (projectURL && targetAppId && resolvedSlug
                  ? `${projectURL}/apps/${targetAppId}/variants?tab=deployments&selectedEnvName=${encodeURIComponent(
                        resolvedSlug,
                    )}`
                  : null))

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={
                    isDeleted
                        ? `Environment ${environmentSlug ?? environmentId ?? ""} was deleted`
                        : `Deployed to ${label}`
                }
                copyValue={resolvedSlug ?? ref?.id ?? environmentId ?? undefined}
                className="max-w-[220px] w-fit"
                tone="environment"
                identifiers={{
                    name: label,
                    slug: resolvedSlug,
                    id: ref?.id ?? environmentId ?? null,
                }}
                deleted={isDeleted}
                openExternally={openExternally}
                hovercardPlacement={hovercardPlacement}
            />
        )
    },
)

/**
 * Generic testset tag list that renders multiple testset tags.
 * Requires projectId to be passed explicitly for reusability across contexts.
 * If revisionMap is provided, it maps testset IDs to revision IDs for direct linking.
 */
export const TestsetTagList = memo(
    ({
        ids,
        revisionMap,
        projectId,
        projectURL,
        className,
        toneOverride,
        showIconOverride,
        openExternally = false,
        hovercardPlacement,
    }: {
        ids: string[]
        revisionMap?: Map<string, string | null>
        projectId: string | null
        projectURL?: string | null
        className?: string
        toneOverride?: ReferenceTone | null
        showIconOverride?: boolean
        openExternally?: boolean
        hovercardPlacement?: TooltipPlacement
    }) => {
        if (!ids.length) {
            return <Text type="secondary">—</Text>
        }

        return (
            <div className={clsx("flex flex-wrap gap-2", className)}>
                {ids.map((id) => (
                    <TestsetTag
                        key={id}
                        testsetId={id}
                        revisionId={revisionMap?.get(id)}
                        projectId={projectId}
                        projectURL={projectURL}
                        toneOverride={toneOverride}
                        showIconOverride={showIconOverride}
                        openExternally={openExternally}
                        hovercardPlacement={hovercardPlacement}
                    />
                ))}
            </div>
        )
    },
)

/**
 * Generic application reference label that fetches and displays an app reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const ApplicationReferenceLabel = memo(
    ({
        applicationId,
        projectId,
        projectURL,
        href: explicitHref,
        openExternally = false,
        label: customLabel,
        toneOverride,
        showIconOverride,
        hovercardPlacement,
    }: {
        applicationId: string | null
        projectId: string | null
        projectURL?: string | null
        href?: string | null
        openExternally?: boolean
        label?: string
        toneOverride?: ReferenceTone | null
        showIconOverride?: boolean
        hovercardPlacement?: TooltipPlacement
    }) => {
        const queryAtom = useMemo(
            () => appReferenceAtomFamily({projectId, appId: applicationId}),
            [projectId, applicationId],
        )
        const query = useAtomValue(queryAtom)

        if (!applicationId) {
            if (customLabel) {
                return (
                    <ReferenceTag label={customLabel} className="max-w-[220px] w-fit" tone="app" />
                )
            }
            return <Text type="secondary">—</Text>
        }

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        // If we have an ID but no name/slug, or query errored, the app was likely deleted
        const isDeleted = Boolean(query.isError || (ref?.id && !ref?.name && !ref?.slug))
        const label = isDeleted
            ? "Deleted"
            : (ref?.name ?? ref?.slug ?? customLabel ?? ref?.id ?? applicationId)
        // Don't show link for deleted apps
        const href = isDeleted
            ? null
            : (explicitHref ??
              (projectURL && applicationId ? `${projectURL}/apps/${applicationId}` : null))

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Application ${applicationId} was deleted` : undefined}
                copyValue={applicationId ?? undefined}
                className="max-w-[220px] w-fit"
                tone={toneOverride === null ? undefined : (toneOverride ?? "app")}
                entityKind="app"
                identifiers={{
                    name: label,
                    slug: ref?.slug ?? null,
                    id: applicationId,
                }}
                deleted={isDeleted}
                showIcon={showIconOverride ?? true}
                openExternally={openExternally}
                hovercardPlacement={hovercardPlacement}
            />
        )
    },
)

/**
 * Generic variant reference label that fetches and displays a variant config reference.
 * Uses revisionId to fetch variant config details.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const VariantReferenceLabel = memo(
    ({
        revisionId,
        projectId: _projectId,
        fallbackLabel,
        // Version now renders inside the chip whenever it resolves; kept for API compat.
        showVersionPill: _showVersionPill = false,
        explicitVersion,
        href: explicitHref,
        openExternally = false,
        label: customLabel,
        toneOverride,
        showIconOverride,
        hovercardPlacement,
    }: {
        revisionId?: string | null
        projectId: string | null
        fallbackLabel?: string | null
        showVersionPill?: boolean
        explicitVersion?: number | string | null
        href?: string | null
        openExternally?: boolean
        label?: string
        toneOverride?: ReferenceTone | null
        showIconOverride?: boolean
        hovercardPlacement?: TooltipPlacement
    }) => {
        const dataAtom = useMemo(
            () => workflowMolecule.selectors.data(revisionId ?? ""),
            [revisionId],
        )
        const queryAtom = useMemo(
            () => workflowMolecule.selectors.query(revisionId ?? ""),
            [revisionId],
        )
        const data = useAtomValue(dataAtom)
        const query = useAtomValue(queryAtom)

        if (!revisionId) {
            if (customLabel) {
                return (
                    <ReferenceTag
                        label={customLabel}
                        className="max-w-[220px] w-fit"
                        tone="variant"
                    />
                )
            }
            return <Text type="secondary">—</Text>
        }

        if (query.isPending && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const hasResolvedData = data?.name || data?.slug || data?.version != null || fallbackLabel
        const isDeleted =
            Boolean(query.isError && !fallbackLabel) || (!hasResolvedData && !fallbackLabel)
        const label = isDeleted
            ? "Deleted"
            : (data?.name ?? data?.slug ?? fallbackLabel ?? customLabel ?? revisionId)
        const resolvedVersion = isDeleted ? null : (explicitVersion ?? data?.version ?? null)
        // Don't show link for deleted variants
        const href = isDeleted ? null : explicitHref

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Variant ${revisionId} was deleted` : undefined}
                copyValue={revisionId ?? undefined}
                className="max-w-[220px]"
                tone={toneOverride === null ? undefined : (toneOverride ?? "variant")}
                entityKind="variant"
                identifiers={{
                    name: label,
                    slug: data?.slug ?? null,
                    id: data?.workflow_variant_id ?? data?.variant_id ?? null,
                    version: resolvedVersion,
                    revisionId: revisionId,
                }}
                deleted={isDeleted}
                showIcon={showIconOverride ?? true}
                openExternally={openExternally}
                hovercardPlacement={hovercardPlacement}
            />
        )
    },
)

/**
 * Combined variant + revision label that displays "variantName v{revision}" in a single chip.
 * Links to the specific revision in the playground.
 * Requires both variantId (for variant name) and revisionId (for revision number).
 */
export const VariantRevisionLabel = memo(
    ({
        variantId,
        revisionId,
        projectId: _projectId,
        fallbackVariantName,
        fallbackRevision,
        href: explicitHref,
        toneOverride,
        showIconOverride,
        hovercardPlacement,
    }: {
        variantId?: string | null
        revisionId?: string | null
        projectId: string | null
        fallbackVariantName?: string | null
        fallbackRevision?: number | string | null
        href?: string | null
        toneOverride?: ReferenceTone | null
        showIconOverride?: boolean
        hovercardPlacement?: TooltipPlacement
    }) => {
        const dataAtom = useMemo(
            () => workflowMolecule.selectors.data(revisionId ?? ""),
            [revisionId],
        )
        const queryAtom = useMemo(
            () => workflowMolecule.selectors.query(revisionId ?? ""),
            [revisionId],
        )
        const data = useAtomValue(dataAtom)
        const query = useAtomValue(queryAtom)

        // Resolve the VARIANT's own label (name, then slug): SDK-created
        // variants and revisions may carry no `name`, and the revision slug
        // is an opaque hex.
        const variantLabel = useAtomValue(
            useMemo(() => workflowMolecule.selectors.variantLabel(revisionId ?? ""), [revisionId]),
        )

        if (!variantId && !revisionId) {
            return <Text type="secondary">—</Text>
        }

        if (query.isPending && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        // Get variant name from the variant entity, workflow data, or fallback
        // Prefer `name` over `slug` — slug can be an opaque ID on older revisions
        const variantName = variantLabel ?? data?.name ?? data?.slug ?? fallbackVariantName ?? null

        // Get revision number from workflow data or fallback
        const revision = data?.version ?? fallbackRevision ?? null

        // Determine if deleted - only mark as deleted if:
        // 1. Query errored AND we have no fallback variant name
        // 2. No data from query AND no fallbacks at all
        const hasFallbackData = fallbackVariantName || fallbackRevision != null
        const hasResolvedData = data?.name || data?.slug || data?.version != null
        const isDeleted = !hasFallbackData && (Boolean(query.isError) || !hasResolvedData)

        // Version renders as a pill inside the chip; the label is just the name.
        const label = isDeleted ? "Deleted" : (variantName ?? revisionId ?? variantId ?? "Unknown")

        const href = isDeleted ? null : explicitHref

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Variant ${revisionId ?? variantId} was deleted` : undefined}
                copyValue={revisionId ?? variantId ?? undefined}
                className="max-w-[220px]"
                tone={toneOverride === null ? undefined : (toneOverride ?? "variant")}
                entityKind="variant"
                identifiers={{
                    name: label,
                    slug: data?.slug ?? null,
                    id: variantId ?? data?.workflow_variant_id ?? data?.variant_id ?? null,
                    version: isDeleted ? null : revision,
                    revisionId: revisionId,
                }}
                deleted={isDeleted}
                showIcon={showIconOverride ?? true}
                hovercardPlacement={hovercardPlacement}
            />
        )
    },
)

/**
 * Generic variant reference text (no tag styling, just text).
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const VariantReferenceText = memo(
    ({
        revisionId,
        projectId: _projectId,
        fallback,
        label: customLabel,
    }: {
        revisionId: string | null
        projectId: string | null
        fallback?: string
        label?: string
    }) => {
        const dataAtom = useMemo(
            () => workflowMolecule.selectors.data(revisionId ?? ""),
            [revisionId],
        )
        const queryAtom = useMemo(
            () => workflowMolecule.selectors.query(revisionId ?? ""),
            [revisionId],
        )
        const data = useAtomValue(dataAtom)
        const query = useAtomValue(queryAtom)

        if (!revisionId) {
            return (
                <Text type="secondary" className="w-fit">
                    {customLabel ?? fallback ?? "—"}
                </Text>
            )
        }

        if (query.isPending) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const label = data?.slug ?? revisionId

        return <Text>{label}</Text>
    },
)

/**
 * Generic evaluator reference label that fetches and displays an evaluator reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const EvaluatorReferenceLabel = memo(
    ({
        evaluatorId,
        evaluatorSlug,
        projectId,
        href: explicitHref,
        openExternally = false,
        label: customLabel,
        toneOverride,
        className,
        hovercardPlacement,
    }: {
        evaluatorId?: string | null
        evaluatorSlug?: string | null
        projectId: string | null
        href?: string | null
        openExternally?: boolean
        label?: string
        toneOverride?: ReferenceTone | null
        className?: string
        hovercardPlacement?: TooltipPlacement
    }) => {
        const queryAtom = useMemo(
            () => evaluatorReferenceAtomFamily({projectId, slug: evaluatorSlug, id: evaluatorId}),
            [projectId, evaluatorSlug, evaluatorId],
        )
        const query = useAtomValue(queryAtom)

        if (!evaluatorId && !evaluatorSlug) {
            if (customLabel) {
                return (
                    <ReferenceTag
                        label={customLabel}
                        className="max-w-[220px] w-fit"
                        tone={toneOverride === null ? undefined : (toneOverride ?? "evaluator")}
                    />
                )
            }
            return <Text type="secondary">—</Text>
        }

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        // If we have an ID/slug but no name, or query errored, the evaluator was likely deleted
        const isDeleted = Boolean(query.isError || ((ref?.id || ref?.slug) && !ref?.name))
        const displayId = evaluatorId ?? evaluatorSlug ?? ref?.id ?? ref?.slug ?? ""
        const label = isDeleted
            ? "Deleted"
            : (ref?.name ??
              ref?.slug ??
              customLabel ??
              ref?.id ??
              evaluatorSlug ??
              evaluatorId ??
              "—")
        // Don't show link for deleted evaluators
        const href = isDeleted ? null : explicitHref
        const workflowTypeColor = getWorkflowTypeColor(ref?.workflowKey)
        const workflowTypeStyle = workflowTypeColor
            ? {
                  backgroundColor: workflowTypeColor.bg,
                  borderColor: workflowTypeColor.border,
                  color: workflowTypeColor.text,
              }
            : undefined

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Evaluator ${displayId} was deleted` : undefined}
                copyValue={displayId}
                className={clsx("max-w-[220px] w-fit", className)}
                tone={toneOverride === null ? undefined : (toneOverride ?? "evaluator")}
                entityKind="evaluator"
                identifiers={{
                    name: label,
                    slug: ref?.slug ?? evaluatorSlug ?? null,
                    id: ref?.id ?? evaluatorId ?? null,
                }}
                deleted={isDeleted}
                openExternally={openExternally}
                style={workflowTypeStyle}
                iconColor={workflowTypeColor?.text}
                hovercardPlacement={hovercardPlacement}
            />
        )
    },
)

/**
 * Generic query reference label that fetches and displays a query reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const QueryReferenceLabel = memo(
    ({
        queryId,
        querySlug,
        projectId,
        href: explicitHref,
        openExternally = false,
        label: customLabel,
        hovercardPlacement,
    }: {
        queryId?: string | null
        querySlug?: string | null
        projectId: string | null
        href?: string | null
        openExternally?: boolean
        label?: string
        hovercardPlacement?: TooltipPlacement
    }) => {
        const queryAtom = useMemo(
            () => queryReferenceAtomFamily({projectId, queryId, querySlug}),
            [projectId, queryId, querySlug],
        )
        const query = useAtomValue(queryAtom)

        if (!queryId && !querySlug) {
            if (customLabel) {
                return <ReferenceTag label={customLabel} className="max-w-[220px]" tone="query" />
            }
            return <Text type="secondary">—</Text>
        }

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        // If we have an ID/slug but no name, or query errored, the query was likely deleted
        const isDeleted = Boolean(query.isError || ((ref?.id || ref?.slug) && !ref?.name))
        const displayId = queryId ?? querySlug ?? ref?.id ?? ref?.slug ?? ""
        const label = isDeleted
            ? "Deleted"
            : (ref?.name ?? ref?.slug ?? customLabel ?? ref?.id ?? querySlug ?? queryId ?? "—")
        // Don't show link for deleted queries
        const href = isDeleted ? null : explicitHref

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Query ${displayId} was deleted` : undefined}
                copyValue={displayId}
                className="max-w-[220px]"
                tone="query"
                identifiers={{
                    name: label,
                    slug: ref?.slug ?? querySlug ?? null,
                    id: ref?.id ?? queryId ?? null,
                }}
                deleted={isDeleted}
                openExternally={openExternally}
                hovercardPlacement={hovercardPlacement}
            />
        )
    },
)
