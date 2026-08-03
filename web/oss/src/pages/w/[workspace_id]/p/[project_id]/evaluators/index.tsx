import EvaluatorsRegistry from "@/oss/components/Evaluators"
import PageTitle from "@/oss/components/PageTitle"

const ProjectEvaluatorsPage = () => {
    return (
        <>
            <PageTitle title="Evaluators" />
            <EvaluatorsRegistry scope="project" />
        </>
    )
}

export default ProjectEvaluatorsPage
