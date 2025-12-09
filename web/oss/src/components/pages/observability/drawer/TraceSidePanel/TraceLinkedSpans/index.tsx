import {Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    setTraceDrawerTraceAtom,
    traceDrawerTraceIdAtom,
    TraceDrawerSpanLink,
    linksAndReferencesAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {useQueryParamState} from "@/oss/state/appState"
import {
    ApplicationReferenceLabel,
    EvaluatorReferenceLabel,
    QueryReferenceLabel,
    TestsetTag,
    VariantReferenceLabel,
} from "@/oss/components/References"

const TraceLinkedSpans = () => {
    const currentTraceId = useAtomValue(traceDrawerTraceIdAtom)
    const setTraceDrawerTrace = useSetAtom(setTraceDrawerTraceAtom)
    const linksAndReferences = useAtomValue(linksAndReferencesAtom)
    const [, setTraceParam] = useQueryParamState("trace")

    const handleNavigate = (link: TraceDrawerSpanLink) => {
        if (!link?.trace_id || !link?.span_id) return

        if (link.trace_id !== currentTraceId) {
            setTraceDrawerTrace({
                traceId: link.trace_id,
                activeSpanId: link.span_id,
                source: "linked",
            })
            setTraceParam(link.trace_id, {shallow: true})
            return
        }

        // setActiveSpan(link.span_id)
    }

    const renderReferenceTags = ({key, id, slug}: {key: string; id: string; slug?: string}) => {
        switch (key) {
            case "application":
                return <ApplicationReferenceLabel applicationId={id} projectId={currentTraceId} />
            case "testset":
                return <TestsetTag testsetId={id} projectId={currentTraceId} />
            case "evaluator":
                return (
                    <EvaluatorReferenceLabel
                        evaluatorId={id}
                        evaluatorSlug={slug}
                        projectId={currentTraceId}
                    />
                )
            default:
                return (
                    <Tag bordered={false} className="cursor-pointer self-start bg-[#0517290F]">
                        {key}
                    </Tag>
                )
        }
    }

    if (!linksAndReferences.links?.length && !linksAndReferences.references?.length) {
        return <Typography.Text type="secondary">No linked spans found.</Typography.Text>
    }
    console.log("linksAndReferences", linksAndReferences)
    return (
        <section className="flex flex-col gap-2">
            {linksAndReferences.links?.length ? (
                <div className="flex flex-col gap-2">
                    <Typography.Text type="secondary">Links</Typography.Text>
                    {linksAndReferences.links?.map((link) => {
                        return (
                            <Tag
                                bordered={false}
                                className="cursor-pointer self-start bg-[#0517290F]"
                                onClick={() => handleNavigate(link)}
                            >
                                {link.key ? `${link.key}` : link.span_id}
                            </Tag>
                        )
                    })}
                </div>
            ) : null}
            {linksAndReferences.references?.length ? (
                <div className="flex flex-col gap-2">
                    <Typography.Text type="secondary">References</Typography.Text>
                    {linksAndReferences.references?.map((link) => {
                        return renderReferenceTags({key: link.key, id: link.id, slug: link.slug})
                    })}
                </div>
            ) : null}
        </section>
    )
}

export default TraceLinkedSpans
