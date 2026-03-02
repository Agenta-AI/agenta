import {useMemo} from "react"

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
            case "application":
                return (
                    <ApplicationReferenceLabel
                        applicationId={id ?? null}
                        projectId={projectId}
                        projectURL={projectURL}
                        label={slug}
                        openExternally
                    />
                )
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
                    />
                )
            case "application_variant": {
                const applicationId = applicationReference?.id || applicationReference?.slug
                const href =
                    projectURL && applicationId && id
                        ? `${projectURL}/apps/${encodeURIComponent(
                              applicationId,
                          )}/variants?revisionId=${encodeURIComponent(id)}`
                        : null

                return (
                    <VariantReferenceLabel
                        revisionId={id}
                        projectId={projectId}
                        showVersionPill
                        href={href || undefined}
                        label={slug}
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
