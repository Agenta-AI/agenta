import {useMemo} from "react"

import {
    buildResolvedTraceRefsKey,
    EMPTY_TRACE_REFS_KEY,
    resolvedTraceRefsAtomFamily,
} from "@agenta/playground"
import {Space, Typography} from "antd"
import {useAtomValue} from "jotai"

import {
    ApplicationReferenceLabel,
    EnvironmentReferenceLabel,
    EvaluatorReferenceLabel,
    TestsetTag,
    VariantReferenceLabel,
} from "@/oss/components/References"
import useEvaluatorNavigation from "@/oss/components/SharedDrawers/TraceDrawer/hooks/useEvaluatorNavigation"
import {linksAndReferencesAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import useURL from "@/oss/hooks/useURL"
import {projectIdAtom} from "@/oss/state/project"

import {useStyles} from "../TraceDetails/assets/styles"

const labelMap: Record<string, string> = {
    evaluator: "Evaluators",
    application: "Applications",
    application_variant: "Variants",
    environment: "Environments",
    testset: "Test sets",
}

const asNonEmpty = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined

const TraceReferences = () => {
    const classes = useStyles()
    const linksAndReferences = useAtomValue(linksAndReferencesAtom)
    const {projectURL} = useURL()
    const projectId = useAtomValue(projectIdAtom)
    const {buildEvaluatorTarget} = useEvaluatorNavigation()

    const references = linksAndReferences?.references || []

    const applicationReference = useMemo(
        () => references.find((ref) => ref?.key === "application"),
        [references],
    )

    // Find testset_revision reference to get the specific revision ID for testset navigation
    // Evaluations store both testset (with testset ID) and testset_revision (with revision ID)
    const testsetRevisionReference = useMemo(
        () => references.find((ref) => ref?.key === "testset_revision"),
        [references],
    )

    // Find application_revision reference to get the revision ID for variant lookup.
    // Traces store both application_variant (with variant ID) and application_revision (with revision ID).
    // The workflowMolecule resolves by revision ID, so we need the revision reference.
    const applicationRevisionReference = useMemo(
        () => references.find((ref) => ref?.key === "application_revision"),
        [references],
    )

    const applicationVariantReference = useMemo(
        () => references.find((ref) => ref?.key === "application_variant"),
        [references],
    )

    // Build the cache key for the trace-ref resolver from whatever
    // application-side refs the active span carries. The resolver maps
    // slug-only refs back to concrete `{appId, revisionId}` via the same
    // backend round-trip the Playground button already uses. When no
    // identifying ref is present we fall back to `EMPTY_TRACE_REFS_KEY`
    // so the family entry stays disabled and no request is fired.
    const resolverKey = useMemo(() => {
        const buildRef = (ref: any) => {
            const id = asNonEmpty(ref?.id)
            const slug = asNonEmpty(ref?.slug)
            const version = asNonEmpty(ref?.version)
            if (!id && !slug && !version) return undefined
            return {id, slug, version}
        }
        const application = buildRef(applicationReference)
        const application_variant = buildRef(applicationVariantReference)
        const application_revision = buildRef(applicationRevisionReference)
        if (!application && !application_variant && !application_revision) {
            return EMPTY_TRACE_REFS_KEY
        }
        return buildResolvedTraceRefsKey({
            application,
            application_variant,
            application_revision,
        })
    }, [applicationReference, applicationVariantReference, applicationRevisionReference])

    const resolvedRefsQuery = useAtomValue(resolvedTraceRefsAtomFamily(resolverKey))
    const resolvedAppId = resolvedRefsQuery.data?.appId ?? null
    const resolvedRevisionId = resolvedRefsQuery.data?.revisionId ?? null

    const groupedReferences = useMemo(() => {
        const validReferences = references?.filter(
            (reference) => (reference as any)?.id || (reference as any)?.slug,
        )

        return validReferences?.reduce<Record<string, Record<string, any>[]>>((acc, reference) => {
            const key = reference?.key || "other"
            if (!acc[key]) acc[key] = []
            acc[key].push(reference)
            return acc
        }, {})
    }, [references])

    const renderReferenceTag = ({key, id, slug}: {key: string; id?: string; slug?: string}) => {
        switch (key) {
            case "application": {
                // Prefer the raw id when the trace already carries one; fall
                // back to the resolver's `appId` so slug-only traces still
                // render a clickable Applications tag.
                const effectiveId = id ?? resolvedAppId ?? null
                return (
                    <ApplicationReferenceLabel
                        applicationId={effectiveId}
                        projectId={projectId}
                        projectURL={projectURL}
                        label={slug}
                        openExternally
                    />
                )
            }
            case "testset":
                return (
                    <TestsetTag
                        testsetId={id}
                        revisionId={testsetRevisionReference?.id}
                        projectId={projectId}
                        projectURL={projectURL}
                        openExternally
                    />
                )
            case "evaluator":
                return (
                    <EvaluatorReferenceLabel
                        evaluatorId={id}
                        evaluatorSlug={slug}
                        projectId={projectId}
                        href={buildEvaluatorTarget({id, slug})?.href ?? undefined}
                        label={slug}
                        openExternally
                    />
                )
            case "environment": {
                // Environment tags link to the env-deployments tab inside
                // the owning app. The link template needs an `applicationId`;
                // when the trace is slug-only we use the resolver's appId.
                const effectiveAppId = applicationReference?.id ?? resolvedAppId ?? undefined
                return (
                    <EnvironmentReferenceLabel
                        environmentId={id}
                        environmentSlug={slug}
                        applicationId={effectiveAppId}
                        projectId={projectId}
                        projectURL={projectURL}
                        label={slug}
                        openExternally
                    />
                )
            }
            case "application_variant": {
                // Variant tag link is `/apps/{appId}/variants?revisionId={revId}`.
                // For slug-only traces both pieces come from the resolver.
                const rawAppId = applicationReference?.id || applicationReference?.slug
                const applicationId = rawAppId ?? resolvedAppId ?? undefined
                const rawRevisionId = (applicationRevisionReference as any)?.id || id
                const revisionId = rawRevisionId ?? resolvedRevisionId ?? undefined
                const href =
                    projectURL && applicationId && revisionId
                        ? `${projectURL}/apps/${encodeURIComponent(
                              applicationId,
                          )}/variants?revisionId=${encodeURIComponent(revisionId)}`
                        : null

                return (
                    <VariantReferenceLabel
                        revisionId={revisionId ?? null}
                        projectId={projectId}
                        showVersionPill
                        href={href || undefined}
                        fallbackLabel={slug}
                        openExternally
                    />
                )
            }
            default:
                return null
        }
    }

    if (!references.length) {
        return <Typography.Text type="secondary">No references found.</Typography.Text>
    }

    return (
        <Space orientation="vertical" size={12} className="w-full">
            {Object.entries(groupedReferences || {}).map(([key, refs]) => {
                const displayLabel = labelMap[key]
                if (!displayLabel) return null
                return (
                    <Space key={key} orientation="vertical" size={6} className="w-full">
                        <Typography.Text className={classes.title}>{displayLabel}</Typography.Text>
                        <div className="flex flex-col gap-1">
                            {refs?.map((ref, index) => {
                                const tag = renderReferenceTag({
                                    key: ref.key as string,
                                    id: (ref as any)?.id,
                                    slug: (ref as any)?.slug,
                                })
                                if (!tag) return null
                                return (
                                    <span key={`${ref.key}-${(ref as any)?.id || index}`}>
                                        {tag}
                                    </span>
                                )
                            })}
                        </div>
                    </Space>
                )
            })}
        </Space>
    )
}

export default TraceReferences
