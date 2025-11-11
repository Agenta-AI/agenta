import {useRouter} from "next/router"

import EvalRunDetailsPage from "@/oss/components/EvalRunDetails"

const AppEvaluationResultsPage = () => {
    const router = useRouter()
    const t = (router.query.type as string) || "auto"
    const evalType = t === "online" ? "online" : "auto"
    return <EvalRunDetailsPage evalType={evalType as any} />
}

export default AppEvaluationResultsPage
