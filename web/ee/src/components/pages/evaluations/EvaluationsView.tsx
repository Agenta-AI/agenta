import {useEffect, useMemo} from "react"

import {Radio, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"

import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {JSSTheme} from "@/oss/lib/Types"

const AutoEvaluation = dynamic(
    () => import("@/oss/components/pages/evaluations/autoEvaluation/AutoEvaluation"),
    {ssr: false},
)
const SingleModelEvaluation = dynamic(
    () => import("@/oss/components/HumanEvaluations/SingleModelEvaluation"),
    {ssr: false},
)
const AbTestingEvaluation = dynamic(
    () => import("@/oss/components/HumanEvaluations/AbTestingEvaluation"),
    {ssr: false},
)

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.marginLG,
    },
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
}))

type EvaluationScope = "app" | "project"

const formatLabel = (value: string) => value.replaceAll("_", " ")

interface EvaluationsViewProps {
    scope?: EvaluationScope
}

const allowedOptionsByScope: Record<EvaluationScope, {value: string; label: string}[]> = {
    app: [
        {value: "auto_evaluation", label: "Automatic"},
        {value: "human_annotation", label: "Human annotation"},
        {value: "human_ab_testing", label: "A/B Testing"},
    ],
    project: [
        {value: "auto_evaluation", label: "Automatic"},
        {value: "human_annotation", label: "Human annotation"},
    ],
}

const EvaluationsView = ({scope = "app"}: EvaluationsViewProps) => {
    const classes = useStyles()
    const router = useRouter()
    const routeAppId = useAppId()

    const uniqueScopeKey = useMemo(() => {
        if (scope !== "app") return "project"
        if (!routeAppId) return "app"
        const parts = routeAppId.split("-")
        return parts[parts.length - 1] || "app"
    }, [scope, routeAppId])

    const [defaultKey, setDefaultKey] = useLocalStorage(
        `${uniqueScopeKey}-last-visited-evaluation`,
        "auto_evaluation",
    )
    const [selectedEvaluation, setSelectedEvaluation] = useQueryParam(
        "selectedEvaluation",
        defaultKey,
    )

    // Ensure selected evaluation is valid for current scope
    useEffect(() => {
        const allowed = allowedOptionsByScope[scope].map((option) => option.value)
        if (!selectedEvaluation || !router.query.selectedEvaluation) {
            setSelectedEvaluation(defaultKey)
            return
        }

        if (!allowed.includes(selectedEvaluation)) {
            const fallback = allowed.includes(defaultKey) ? defaultKey : allowed[0]
            setSelectedEvaluation(fallback)
        }
    }, [
        selectedEvaluation,
        defaultKey,
        setSelectedEvaluation,
        scope,
        router.query.selectedEvaluation,
    ])

    useEffect(() => {
        if (selectedEvaluation && selectedEvaluation !== defaultKey) {
            setDefaultKey(selectedEvaluation)
        }
    }, [selectedEvaluation, defaultKey, setDefaultKey])

    useBreadcrumbsEffect(
        {
            breadcrumbs:
                scope === "app"
                    ? {appPage: {label: formatLabel(selectedEvaluation)}}
                    : {projectPage: {label: formatLabel(selectedEvaluation)}},
            type: "append",
            condition: !!selectedEvaluation,
        },
        [selectedEvaluation, scope, router.asPath],
    )

    const renderPage = useMemo(() => {
        switch (selectedEvaluation) {
            case "human_annotation":
                return <SingleModelEvaluation viewType="evaluation" scope={scope} />
            case "human_ab_testing":
                return scope === "app" ? (
                    <AbTestingEvaluation viewType="evaluation" />
                ) : (
                    <AutoEvaluation viewType="evaluation" scope={scope} />
                )
            case "auto_evaluation":
            default:
                return <AutoEvaluation viewType="evaluation" scope={scope} />
        }
    }, [selectedEvaluation, scope])

    const options = allowedOptionsByScope[scope]

    return (
        <div className={clsx(classes.container, "grow flex flex-col min-h-0")}>
            <div className="flex items-center gap-4">
                <Typography.Text className="text-[16px] font-medium">Evaluations</Typography.Text>
                <Radio.Group
                    optionType="button"
                    value={selectedEvaluation}
                    onChange={(e) => setSelectedEvaluation(e.target.value)}
                >
                    {options.map((option) => (
                        <Radio.Button key={option.value} value={option.value}>
                            {option.label}
                        </Radio.Button>
                    ))}
                </Radio.Group>
            </div>

            <div className={clsx("grow flex flex-col min-h-0")}>{renderPage}</div>
        </div>
    )
}

export default EvaluationsView
