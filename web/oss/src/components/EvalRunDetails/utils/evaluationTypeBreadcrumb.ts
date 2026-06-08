import type {EvaluationRunKind} from "@/oss/lib/evaluations/utils/evaluationKind"

export const EVALUATION_TYPE_BREADCRUMB: Record<EvaluationRunKind, {label: string; kind: string}> =
    {
        auto: {label: "Auto Evals", kind: "auto"},
        human: {label: "Human Evals", kind: "human"},
        online: {label: "Live Evals", kind: "online"},
        custom: {label: "SDK Evals", kind: "custom"},
    }

export const buildEvaluationTypeBreadcrumb = ({
    evaluationType,
    projectURL,
}: {
    evaluationType: EvaluationRunKind
    projectURL?: string | null
}) => {
    const config = EVALUATION_TYPE_BREADCRUMB[evaluationType]

    return {
        label: config.label,
        href: projectURL ? `${projectURL}/evaluations?kind=${config.kind}` : undefined,
    }
}
