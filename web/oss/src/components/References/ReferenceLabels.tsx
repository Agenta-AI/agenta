import {memo, useMemo} from "react"

import {Skeleton, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {
    latestRevisionForTestsetAtomFamily,
    revisionEntityAtomFamily,
} from "@/oss/state/entities/testset"

import {
    appReferenceAtomFamily,
    evaluatorReferenceAtomFamily,
    environmentReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
    queryReferenceAtomFamily,
    variantConfigAtomFamily,
} from "./atoms/entityReferences"
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
        openExternally = false,
    }: {
        testsetId: string
        revisionId?: string | null
        projectId: string | null
        projectURL?: string | null
        openExternally?: boolean
    }) => {
        const queryAtom = useMemo(
            () => previewTestsetReferenceAtomFamily({projectId, testsetId}),
            [projectId, testsetId],
        )
        const query = useAtomValue(queryAtom)

        // Fetch revision entity to get version number (must be called before any early returns)
        const revisionEntity = useAtomValue(revisionEntityAtomFamily(revisionId ?? ""))
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
        const baseName = ref?.name ?? ref?.id ?? testsetId
        // Append version to label if available
        const label = isDeleted
            ? "Deleted"
            : revisionVersion != null
              ? `${baseName} v${revisionVersion}`
              : baseName
        // Don't show link for deleted testsets
        // Use revision ID for URL if available, then try latest revision, finally fall back to testset ID
        // For old evaluations without revision info, we use testset ID which the page should handle
        const targetId = revisionId ?? latestRevision?.id ?? testsetId
        const href = isDeleted ? null : projectURL ? `${projectURL}/testsets/${targetId}` : null

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Testset ${testsetId} was deleted` : label}
                copyValue={testsetId}
                className="max-w-[220px] w-fit"
                tone="testset"
                openExternally={openExternally}
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
    }: {
        environmentId?: string | null
        environmentSlug?: string | null
        projectId: string | null
        applicationId?: string | null
        projectURL?: string | null
        href?: string | null
        openExternally?: boolean
        label?: string
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
                openExternally={openExternally}
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
        openExternally = false,
    }: {
        ids: string[]
        revisionMap?: Map<string, string | null>
        projectId: string | null
        projectURL?: string | null
        className?: string
        openExternally?: boolean
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
                        openExternally={openExternally}
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
    }: {
        applicationId: string | null
        projectId: string | null
        projectURL?: string | null
        href?: string | null
        openExternally?: boolean
        label?: string
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
                tooltip={isDeleted ? `Application ${applicationId} was deleted` : label}
                copyValue={applicationId ?? undefined}
                className="max-w-[220px] w-fit"
                tone="app"
                openExternally={openExternally}
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
        projectId,
        fallbackLabel,
        showVersionPill = false,
        explicitVersion,
        href: explicitHref,
        openExternally = false,
        label: customLabel,
    }: {
        revisionId?: string | null
        projectId: string | null
        fallbackLabel?: string | null
        showVersionPill?: boolean
        explicitVersion?: number | string | null
        href?: string | null
        openExternally?: boolean
        label?: string
    }) => {
        const queryAtom = useMemo(
            () => variantConfigAtomFamily({projectId, revisionId}),
            [projectId, revisionId],
        )
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

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const hasResolvedData = ref?.variantName || ref?.revision != null || fallbackLabel
        const isDeleted =
            Boolean(query.isError && !fallbackLabel) || (!hasResolvedData && !fallbackLabel)
        const label = isDeleted
            ? "Deleted"
            : (ref?.variantName ?? fallbackLabel ?? customLabel ?? ref?.revisionId ?? revisionId)
        const resolvedVersion = isDeleted ? null : (explicitVersion ?? ref?.revision ?? null)
        // Don't show link for deleted variants
        const href = isDeleted ? null : explicitHref

        return (
            <div className="flex items-center gap-2">
                <ReferenceTag
                    label={label}
                    href={href ?? undefined}
                    tooltip={isDeleted ? `Variant ${revisionId} was deleted` : label}
                    copyValue={revisionId ?? undefined}
                    className="max-w-[220px]"
                    tone="variant"
                    openExternally={openExternally}
                />
                {showVersionPill && resolvedVersion ? (
                    <span className="rounded-md bg-[#F2F4F7] px-2 py-0.5 text-xs font-medium text-[#344054]">
                        v{resolvedVersion}
                    </span>
                ) : null}
            </div>
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
        projectId,
        fallbackVariantName,
        fallbackRevision,
        href: explicitHref,
    }: {
        variantId?: string | null
        revisionId?: string | null
        projectId: string | null
        fallbackVariantName?: string | null
        fallbackRevision?: number | string | null
        href?: string | null
    }) => {
        // Fetch variant config using revisionId to get revision number
        const configQueryAtom = useMemo(
            () => variantConfigAtomFamily({projectId, revisionId}),
            [projectId, revisionId],
        )
        const configQuery = useAtomValue(configQueryAtom)

        if (!variantId && !revisionId) {
            return <Text type="secondary">—</Text>
        }

        const isLoading = (configQuery.isPending || configQuery.isFetching) && !configQuery.isError

        if (isLoading) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const configRef = configQuery.data

        // Get variant name from config query or fallback
        const variantName = configRef?.variantName ?? fallbackVariantName ?? null

        // Get revision number from config query or fallback
        const revision = configRef?.revision ?? fallbackRevision ?? null

        // Determine if deleted - only mark as deleted if:
        // 1. Query errored AND we have no fallback variant name
        // 2. No data from query AND no fallbacks at all
        const hasFallbackData = fallbackVariantName || fallbackRevision != null
        const hasResolvedData = configRef?.variantName || configRef?.revision != null
        const isDeleted = !hasFallbackData && (Boolean(configQuery.isError) || !hasResolvedData)

        // Build combined label: "variantName v{revision}"
        const label = isDeleted
            ? "Deleted"
            : revision != null
              ? `${variantName ?? "variant"} v${revision}`
              : (variantName ?? revisionId ?? variantId ?? "Unknown")

        const href = isDeleted ? null : explicitHref

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Variant ${revisionId ?? variantId} was deleted` : label}
                copyValue={revisionId ?? variantId ?? undefined}
                className="max-w-[220px]"
                tone="variant"
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
        projectId,
        fallback,
        label: customLabel,
    }: {
        revisionId: string | null
        projectId: string | null
        fallback?: string
        label?: string
    }) => {
        const queryAtom = useMemo(
            () => variantConfigAtomFamily({projectId, revisionId}),
            [projectId, revisionId],
        )
        const query = useAtomValue(queryAtom)

        if (!revisionId) {
            return (
                <Text type="secondary" className="w-fit">
                    {customLabel ?? fallback ?? "—"}
                </Text>
            )
        }

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const label = ref?.variantName ?? ref?.revisionId ?? revisionId

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
    }: {
        evaluatorId?: string | null
        evaluatorSlug?: string | null
        projectId: string | null
        href?: string | null
        openExternally?: boolean
        label?: string
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
                        tone="evaluator"
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

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Evaluator ${displayId} was deleted` : label}
                copyValue={displayId}
                className="max-w-[220px] w-fit"
                tone="evaluator"
                openExternally={openExternally}
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
    }: {
        queryId?: string | null
        querySlug?: string | null
        projectId: string | null
        href?: string | null
        openExternally?: boolean
        label?: string
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
                tooltip={isDeleted ? `Query ${displayId} was deleted` : label}
                copyValue={displayId}
                className="max-w-[220px]"
                tone="query"
                openExternally={openExternally}
            />
        )
    },
)
