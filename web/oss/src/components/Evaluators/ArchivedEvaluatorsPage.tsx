import {useRouter} from "next/router"

import ArchivedEntityLayout from "@/oss/components/ArchivedEntityLayout"
import useURL from "@/oss/hooks/useURL"

import EvaluatorsRegistry from "."

export default function ArchivedEvaluatorsPage() {
    const router = useRouter()
    const {projectURL} = useURL()

    return (
        <ArchivedEntityLayout
            title="Archived Evaluators"
            subtitle="Archived evaluators are hidden from your workspace but can be restored at any time."
            onBack={() => router.push(`${projectURL}/evaluators`)}
        >
            <EvaluatorsRegistry mode="archived" />
        </ArchivedEntityLayout>
    )
}
