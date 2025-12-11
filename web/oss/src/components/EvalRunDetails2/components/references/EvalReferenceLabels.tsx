/**
 * Evaluation-specific reference label components.
 * These wrap the generic Reference components and provide projectId from context.
 */
import {memo} from "react"

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

import {effectiveProjectIdAtom} from "../../atoms/run"
import useRunIdentifiers from "../../hooks/useRunIdentifiers"
import useRunScopedUrls from "../../hooks/useRunScopedUrls"

/**
 * Evaluation-scoped testset tag.
 * Gets projectId from evaluation context.
 */
export const TestsetTag = memo(
    ({
        testsetId,
        projectURL,
        runId,
    }: {
        testsetId: string
        projectURL?: string | null
        runId?: string | null
    }) => {
        const projectId = useAtomValue(effectiveProjectIdAtom)
        const {buildTestsetHref} = useRunScopedUrls(runId)
        const href = buildTestsetHref(testsetId) ?? projectURL ?? undefined

        return (
            <GenericTestsetTag
                testsetId={testsetId}
                projectId={projectId}
                projectURL={href ? undefined : projectURL}
            />
        )
    },
)

/**
 * Evaluation-scoped testset tag list.
 * Gets projectId from evaluation context.
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
        const {buildTestsetHref} = useRunScopedUrls(runId)

        // Use the first testset's href as base projectURL if available
        const resolvedProjectURL =
            ids.length > 0 ? buildTestsetHref(ids[0])?.replace(`/testsets/${ids[0]}`, "") : null

        return (
            <GenericTestsetTagList
                ids={ids}
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

        const {buildRevisionPlaygroundHref} = useRunScopedUrls(runId, effectiveApplicationId)

        // Link to the specific revision in playground
        const href = buildRevisionPlaygroundHref(effectiveVariantId, effectiveRevisionId)

        return (
            <GenericVariantRevisionLabel
                variantId={effectiveVariantId}
                revisionId={effectiveRevisionId}
                projectId={projectId}
                fallbackVariantName={fallbackVariantName}
                fallbackRevision={fallbackRevision}
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
