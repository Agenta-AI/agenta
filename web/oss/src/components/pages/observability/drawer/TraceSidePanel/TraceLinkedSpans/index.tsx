import {useMemo} from "react"

import {Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    setTraceDrawerTraceAtom,
    TraceDrawerSpanLink,
    linksAndReferencesAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {projectIdAtom} from "@/oss/state/project"
import {
    ApplicationReferenceLabel,
    EvaluatorReferenceLabel,
    TestsetTag,
} from "@/oss/components/References"
import useURL from "@/oss/hooks/useURL"
import useEvaluatorNavigation from "@/oss/components/pages/observability/drawer/hooks/useEvaluatorNavigation"
import React from "react"
import {TreeStructureIcon} from "@phosphor-icons/react"

const TraceLinkedSpans = () => {
    const {projectURL} = useURL()
    const projectId = useAtomValue(projectIdAtom)
    const setTraceDrawerTrace = useSetAtom(setTraceDrawerTraceAtom)
    const linksAndReferences = useAtomValue(linksAndReferencesAtom)
    const {buildEvaluatorTarget} = useEvaluatorNavigation()
    const handleNavigate = (link: TraceDrawerSpanLink) => {
        if (!link?.trace_id || !link?.span_id) return

        setTraceDrawerTrace({
            traceId: link.trace_id,
            activeSpanId: link.span_id,
            source: "linked",
        })
    }

    const renderReferenceTags = ({key, id, slug}: {key: string; id: string; slug?: string}) => {
        switch (key) {
            case "application":
                return (
                    <ApplicationReferenceLabel
                        applicationId={id}
                        projectId={projectId}
                        projectURL={projectURL}
                    />
                )
            case "testset":
                return <TestsetTag testsetId={id} projectId={projectId} projectURL={projectURL} />
            case "evaluator":
                return (
                    <EvaluatorReferenceLabel
                        evaluatorId={id}
                        evaluatorSlug={slug}
                        projectId={projectId}
                        href={buildEvaluatorTarget({id, slug})?.href ?? undefined}
                    />
                )
            default:
                return null
        }
    }

    const validLinks = useMemo(
        () =>
            (linksAndReferences?.links || [])?.filter(
                (link) => link?.trace_id && link?.span_id,
            ) as TraceDrawerSpanLink[],
        [linksAndReferences?.links],
    )

    if (!validLinks.length && !linksAndReferences.references?.length) {
        return <Typography.Text type="secondary">No linked spans found.</Typography.Text>
    }

    return (
        <section className="flex flex-col gap-2">
            {validLinks.length ? (
                <div className="flex flex-col gap-2">
                    <Typography.Text type="secondary">Links</Typography.Text>
                    {validLinks.map((link) => {
                        return (
                            <Tag
                                key={`${link.trace_id}-${link.span_id}-${link.key || ""}`}
                                bordered={false}
                                className="cursor-pointer self-start bg-[#0517290F] flex gap-1 items-center"
                                onClick={() => handleNavigate(link)}
                            >
                                <TreeStructureIcon size={14} />{" "}
                                {link?.trace?.[0]?.span_name || link?.key}
                            </Tag>
                        )
                    })}
                </div>
            ) : null}
            {linksAndReferences.references?.length ? (
                <div className="flex flex-col gap-2">
                    <Typography.Text type="secondary">References</Typography.Text>
                    {linksAndReferences.references?.map((link) => {
                        return (
                            <React.Fragment key={`${link.key}-${link.id}-${link.slug || ""}`}>
                                {renderReferenceTags({key: link.key, id: link.id, slug: link.slug})}
                            </React.Fragment>
                        )
                    })}
                </div>
            ) : null}
        </section>
    )
}

export default TraceLinkedSpans
