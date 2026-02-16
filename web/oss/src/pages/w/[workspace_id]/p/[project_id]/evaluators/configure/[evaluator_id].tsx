import {useMemo} from "react"

import {useRouter} from "next/router"

import ConfigureEvaluatorPage from "@/oss/components/Evaluators/components/ConfigureEvaluator"

const EvaluatorConfigureRoute = () => {
    const router = useRouter()
    const evaluatorId = useMemo(() => {
        const id = router.query.evaluator_id
        if (Array.isArray(id)) {
            return id[0]
        }
        return id ?? null
    }, [router.query.evaluator_id])

    return <ConfigureEvaluatorPage evaluatorId={evaluatorId} />
}

export default EvaluatorConfigureRoute
