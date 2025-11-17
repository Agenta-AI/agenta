import {useRouter} from "next/router"

import EvalRunDetailsPage from "@/oss/components/EvalRunDetails"

const AppEvaluationResultsPage = () => {
    const router = useRouter()
    const rawType = (router.query.type as string | undefined)?.toLowerCase()
    const evalType: "auto" | "human" = rawType === "human" ? "human" : "auto"
    return <EvalRunDetailsPage evalType={evalType} />
}

export default AppEvaluationResultsPage
