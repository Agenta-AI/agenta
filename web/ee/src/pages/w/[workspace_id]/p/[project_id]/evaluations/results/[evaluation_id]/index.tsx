import {useRouter} from "next/router"

import EvalRunDetailsPage from "@/oss/components/EvalRunDetails"

const ProjectEvaluationResultsPage = () => {
    const router = useRouter()
    const rawType =
        (Array.isArray(router.query.eval_type)
            ? router.query.eval_type[0]
            : router.query.eval_type) ||
        (Array.isArray(router.query.type) ? router.query.type[0] : router.query.type)
    const normalized =
        rawType === "online"
            ? "online"
            : rawType === "human"
              ? "human"
              : rawType === "custom"
                ? "custom"
                : "auto"
    return <EvalRunDetailsPage evalType={normalized} />
}

export default ProjectEvaluationResultsPage
