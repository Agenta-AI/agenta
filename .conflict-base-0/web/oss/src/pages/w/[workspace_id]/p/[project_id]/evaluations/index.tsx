import EvaluationsView from "@/oss/components/pages/evaluations/EvaluationsView"
import PageTitle from "@/oss/components/PageTitle"

const ProjectEvaluationsPage = () => {
    return (
        <>
            <PageTitle title="Evaluation runs" />
            <EvaluationsView scope="project" />
        </>
    )
}

export default ProjectEvaluationsPage
