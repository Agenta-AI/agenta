/**
 * Evaluation-specific reference label components.
 * These wrap the generic Reference components and provide projectId from context.
 */
import {memo, useMemo} from "react"

import {useAtomValue} from "jotai"

import {
    ApplicationReferenceLabel as GenericApplicationReferenceLabel,
    QueryReferenceLabel as GenericQueryReferenceLabel,
    TestsetTag as GenericTestsetTag,
    TestsetTagList as GenericTestsetTagList,
    VariantReferenceLabel as GenericVariantReferenceLabel,
    VariantReferenceText as GenericVariantReferenceText,
    VariantRevisionLabel as GenericVariantRevisionLabel,
} from "@/oss/components/References"

import {variantReferenceQueryAtomFamily} from "../../atoms/references"
import {effectiveProjectIdAtom} from "../../atoms/run"
import {runTestsetRefsAtomFamily} from "../../atoms/runDerived"
import useRunIdentifiers from "../../hooks/useRunIdentifiers"
import useRunScopedUrls from "../../hooks/useRunScopedUrls"

/**
 * Evaluation-scoped testset tag.
 * Gets projectId from evaluation context.
 * Uses revision ID for URL if available from run data.
 */
export const TestsetTag = memo(
    ({
        testsetId,
        revisionId: explicitRevisionId,
        projectURL,
        runId,
    }: {
        testsetId: string
        revisionId?: string | null
        projectURL?: string | null
        runId?: string | null
    }) => {
        const projectId = useAtomValue(effectiveProjectIdAtom)
        const testsetRefsAtom = useMemo(() => runTestsetRefsAtomFamily(runId ?? null), [runId])
        const testsetRefs = useAtomValue(testsetRefsAtom)
        const {buildTestsetHref} = useRunScopedUrls(runId)

        // Find revision ID from run data if not explicitly provided
        const runRevisionId = testsetRefs.find((ref) => ref.testsetId === testsetId)?.revisionId
        const revisionId = explicitRevisionId ?? runRevisionId ?? null

        const href = buildTestsetHref(testsetId, revisionId) ?? projectURL ?? undefined

        return (
            <GenericTestsetTag
                testsetId={testsetId}
                revisionId={revisionId}
                projectId={projectId}
                projectURL={href ? undefined : projectURL}
            />
        )
    },
)

/**
 * Evaluation-scoped testset tag list.
 * Gets projectId from evaluation context.
 * Uses revision IDs for URLs if available from run data.
 */
export const TestsetTagList = memo(
    ({
        ids,
        projectURL,
        runId,
        className,
    }: {
        ids: string[]
        projectURL?: string | null
        runId?: string | null
        className?: string
    }) => {
        const projectId = useAtomValue(effectiveProjectIdAtom)
        const testsetRefsAtom = useMemo(() => runTestsetRefsAtomFamily(runId ?? null), [runId])
        const testsetRefs = useAtomValue(testsetRefsAtom)
        const {buildTestsetHref} = useRunScopedUrls(runId)

        // Build a map of testsetId -> revisionId from run data
        const revisionMap = useMemo(() => {
            const map = new Map<string, string | null>()
            for (const ref of testsetRefs) {
                map.set(ref.testsetId, ref.revisionId)
            }
            return map
        }, [testsetRefs])

        // Use the first testset's href as base projectURL if available
        const firstRevisionId = ids.length > 0 ? revisionMap.get(ids[0]) : null
        const resolvedProjectURL =
            ids.length > 0
                ? buildTestsetHref(ids[0], firstRevisionId)?.replace(
                      `/testsets/${firstRevisionId ?? ids[0]}`,
                      "",
                  )
                : null

        return (
            <GenericTestsetTagList
                ids={ids}
                revisionMap={revisionMap}
                projectId={projectId}
                projectURL={resolvedProjectURL ?? projectURL}
                className={className}
            />
        )
    },
)

/**
 * Evaluation-scoped application reference label.
 * Gets projectId from evaluation context and applicationId from run if not provided.
 */
export const ApplicationReferenceLabel = memo(
    ({
        runId,
        applicationId: explicitApplicationId,
        projectURL: explicitProjectURL,
    }: {
        runId?: string | null
        applicationId?: string | null
        projectURL?: string | null
    }) => {
        const projectId = useAtomValue(effectiveProjectIdAtom)
        const {applicationId: runApplicationId} = useRunIdentifiers(runId)
        const {projectURL: scopedProjectURL, appDetailHref} = useRunScopedUrls(
            runId,
            explicitApplicationId ?? runApplicationId ?? null,
        )

        const applicationId = explicitApplicationId ?? runApplicationId ?? null

        return (
            <GenericApplicationReferenceLabel
                applicationId={applicationId}
                projectId={projectId}
                projectURL={explicitProjectURL ?? scopedProjectURL}
                href={appDetailHref}
            />
        )
    },
)

/**
 * Evaluation-scoped variant reference label.
 * Gets projectId from evaluation context and variantId from run if not provided.
 */
export const VariantReferenceLabel = memo(
    ({
        variantId: explicitVariantId,
        applicationId: explicitApplicationId,
        runId,
        fallbackLabel,
        showVersionPill = false,
        explicitVersion,
    }: {
        variantId?: string | null
        applicationId?: string | null
        runId?: string | null
        fallbackLabel?: string | null
        showVersionPill?: boolean
        explicitVersion?: number | string | null
    }) => {
        const projectId = useAtomValue(effectiveProjectIdAtom)
        const {variantId: runVariantId, applicationId: runApplicationId} = useRunIdentifiers(runId)
        const effectiveVariantId = explicitVariantId ?? runVariantId ?? null
        const effectiveApplicationId = explicitApplicationId ?? runApplicationId ?? null
        const {buildVariantPlaygroundHref} = useRunScopedUrls(runId, effectiveApplicationId)

        const href = buildVariantPlaygroundHref(effectiveVariantId)

        return (
            <GenericVariantReferenceLabel
                revisionId={effectiveVariantId}
                projectId={projectId}
                fallbackLabel={fallbackLabel}
                showVersionPill={showVersionPill}
                explicitVersion={explicitVersion}
                href={href}
            />
        )
    },
)

/**
 * Evaluation-scoped combined variant + revision label.
 * Displays "variantName v{revision}" in a single chip that links to the specific revision.
 * Gets projectId from evaluation context and IDs from run if not provided.
 * Fetches variant details to use as fallbacks when not explicitly provided.
 */
export const VariantRevisionLabel = memo(
    ({
        variantId: explicitVariantId,
        revisionId: explicitRevisionId,
        applicationId: explicitApplicationId,
        runId,
        fallbackVariantName,
        fallbackRevision,
    }: {
        variantId?: string | null
        revisionId?: string | null
        applicationId?: string | null
        runId?: string | null
        fallbackVariantName?: string | null
        fallbackRevision?: number | string | null
    }) => {
        const projectId = useAtomValue(effectiveProjectIdAtom)
        const {
            variantId: runVariantId,
            applicationId: runApplicationId,
            rawRefs,
        } = useRunIdentifiers(runId)

        // Get revision ID from rawRefs if not explicitly provided
        const runRevisionId =
            rawRefs?.applicationRevision?.id ?? rawRefs?.application_revision?.id ?? null
        const effectiveRevisionId = explicitRevisionId ?? runRevisionId ?? null
        const effectiveVariantId = explicitVariantId ?? runVariantId ?? null
        const effectiveApplicationId = explicitApplicationId ?? runApplicationId ?? null

        // Fetch variant details to use as fallbacks
        const variantAtom = useMemo(
            () => variantReferenceQueryAtomFamily(effectiveVariantId),
            [effectiveVariantId],
        )
        const variantQuery = useAtomValue(variantAtom)
        const variantResolved = variantQuery.data

        // Build fallbacks from variant query and rawRefs
        const resolvedVariantName =
            fallbackVariantName ??
            variantResolved?.name ??
            variantResolved?.slug ??
            rawRefs?.applicationVariant?.name ??
            rawRefs?.applicationVariant?.slug ??
            rawRefs?.application_variant?.name ??
            rawRefs?.application_variant?.slug ??
            null

        const resolvedRevision =
            fallbackRevision ??
            variantResolved?.revision ??
            rawRefs?.applicationRevision?.version ??
            rawRefs?.applicationRevision?.revision ??
            rawRefs?.application_revision?.version ??
            rawRefs?.application_revision?.revision ??
            null

        const {buildRevisionPlaygroundHref} = useRunScopedUrls(runId, effectiveApplicationId)

        // Link to the specific revision in playground
        const href = buildRevisionPlaygroundHref(effectiveVariantId, effectiveRevisionId)

        return (
            <GenericVariantRevisionLabel
                variantId={effectiveVariantId}
                revisionId={effectiveRevisionId}
                projectId={projectId}
                fallbackVariantName={resolvedVariantName}
                fallbackRevision={resolvedRevision}
                href={href}
            />
        )
    },
)

/**
 * Evaluation-scoped variant reference text.
 * Gets projectId from evaluation context.
 */
export const VariantReferenceText = memo(
    ({variantId, fallback}: {variantId: string | null; fallback?: string}) => {
        const projectId = useAtomValue(effectiveProjectIdAtom)

        return (
            <GenericVariantReferenceText
                revisionId={variantId}
                projectId={projectId}
                fallback={fallback}
            />
        )
    },
)

/**
 * Evaluation-scoped query reference label.
 * Gets projectId from evaluation context.
 */
export const QueryReferenceLabel = memo(
    ({
        queryId,
        querySlug,
        href,
    }: {
        queryId?: string | null
        querySlug?: string | null
        href?: string | null
    }) => {
        const projectId = useAtomValue(effectiveProjectIdAtom)

        return (
            <GenericQueryReferenceLabel
                queryId={queryId}
                querySlug={querySlug}
                projectId={projectId}
                href={href}
            />
        )
    },
)
