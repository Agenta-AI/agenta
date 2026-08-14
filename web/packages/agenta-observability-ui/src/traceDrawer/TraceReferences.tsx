import {useMemo} from "react"

import {useEvaluatorNavigation} from "@agenta/observability/traceDrawer"
import {linksAndReferencesAtom, traceDrawerProjectURLAtom} from "@agenta/observability/traceDrawer"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {getTraceDrawerReferences} from "./referenceSlots"

const titleClass = "text-sm leading-[1.5714285714285714] font-medium"

// The side panel hugs the right edge of the screen, so hovercards open leftward.
const HOVERCARD_PLACEMENT = "bottomRight" as const

const labelMap: Record<string, string> = {
    evaluator: "Evaluators",
    application: "Applications",
    application_variant: "Variants",
    environment: "Environments",
    testset: "Test sets",
}

interface ReferenceEntry extends Record<string, unknown> {
    key?: string
    id?: string
    slug?: string
}

const TraceReferences = () => {
    const {
        ApplicationReferenceLabel,
        EnvironmentReferenceLabel,
        EvaluatorReferenceLabel,
        TestsetTag,
        VariantReferenceLabel,
    } = getTraceDrawerReferences()

    const linksAndReferences = useAtomValue(linksAndReferencesAtom)
    const projectURL = useAtomValue(traceDrawerProjectURLAtom)
    const projectId = useAtomValue(projectIdAtom)
    const {buildEvaluatorTarget} = useEvaluatorNavigation()

    // The store hands these back as unknown-valued bags; this component reads them as
    // identified references, so name that shape once instead of casting at every read.
    const references = (linksAndReferences?.references ?? []) as ReferenceEntry[]

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

    const groupedReferences = useMemo(() => {
        const validReferences = references?.filter((reference) => reference?.id || reference?.slug)

        return validReferences?.reduce<Record<string, ReferenceEntry[]>>((acc, reference) => {
            const key = reference?.key || "other"
            if (!acc[key]) acc[key] = []
            acc[key].push(reference)
            return acc
        }, {})
    }, [references])

    const renderReferenceTag = ({key, id, slug}: {key: string; id?: string; slug?: string}) => {
        switch (key) {
            case "application":
                return (
                    <ApplicationReferenceLabel
                        applicationId={id ?? null}
                        projectId={projectId}
                        projectURL={projectURL}
                        label={slug}
                        openExternally
                        hovercardPlacement={HOVERCARD_PLACEMENT}
                    />
                )
            case "testset":
                return (
                    <TestsetTag
                        testsetId={id as string}
                        revisionId={testsetRevisionReference?.id}
                        projectId={projectId}
                        projectURL={projectURL}
                        openExternally
                        hovercardPlacement={HOVERCARD_PLACEMENT}
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
                        hovercardPlacement={HOVERCARD_PLACEMENT}
                    />
                )
            case "environment":
                return (
                    <EnvironmentReferenceLabel
                        environmentId={id}
                        environmentSlug={slug}
                        applicationId={applicationReference?.id}
                        projectId={projectId}
                        projectURL={projectURL}
                        label={slug}
                        openExternally
                        hovercardPlacement={HOVERCARD_PLACEMENT}
                    />
                )
            case "application_variant": {
                const applicationId = applicationReference?.id || applicationReference?.slug
                // Use the revision ID from application_revision reference for molecule lookup.
                // The variant reference stores a variant ID, but the molecule resolves by revision ID.
                const revisionId = applicationRevisionReference?.id || id
                const href =
                    projectURL && applicationId && revisionId
                        ? `${projectURL}/apps/${encodeURIComponent(
                              applicationId,
                          )}/variants?revisionId=${encodeURIComponent(revisionId)}`
                        : null

                return (
                    <VariantReferenceLabel
                        revisionId={revisionId}
                        projectId={projectId}
                        showVersionPill
                        href={href || undefined}
                        fallbackLabel={slug}
                        openExternally
                        hovercardPlacement={HOVERCARD_PLACEMENT}
                    />
                )
            }
            default:
                return null
        }
    }

    if (!references.length) {
        return <span className="text-colorTextSecondary">No references found.</span>
    }

    return (
        <div className="flex flex-col gap-3 items-start w-full">
            {Object.entries(groupedReferences || {}).map(([key, refs]) => {
                const displayLabel = labelMap[key]
                if (!displayLabel) return null
                return (
                    <div key={key} className="flex flex-col gap-1.5 items-start w-full">
                        <span className={titleClass}>{displayLabel}</span>
                        <div className="flex flex-col gap-1">
                            {refs?.map((ref, index) => {
                                const tag = renderReferenceTag({
                                    key: ref.key as string,
                                    id: ref?.id,
                                    slug: ref?.slug,
                                })
                                if (!tag) return null
                                return <span key={`${ref.key}-${ref?.id || index}`}>{tag}</span>
                            })}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default TraceReferences
