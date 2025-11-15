import {useEffect, useMemo} from "react"

import {Tabs, Typography} from "antd"
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
const OnlineEvaluation = dynamic(() => import("./onlineEvaluation/OnlineEvaluation"), {ssr: false})
const CustomEvaluation = dynamic(() => import("./customEvaluation/CustomEvaluation"), {
    ssr: false,
})

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

interface TabOption {
    value: string
    label: string
    disabled?: boolean
}

interface EvaluationsViewProps {
    scope?: EvaluationScope
}

const allowedOptionsByScope: Record<EvaluationScope, TabOption[]> = {
    app: [
        {value: "auto_evaluation", label: "Automatic Evaluations"},
        {value: "human_annotation", label: "Human Annotations"},
        // {value: "online_evaluation", label: "Online Evaluations"},
        {value: "custom_evaluation", label: "SDK Evaluations"},
        {value: "human_ab_testing", label: "A/B Testing"},
    ],
    project: [
        {value: "auto_evaluation", label: "Automatic Evaluations"},
        {value: "human_annotation", label: "Human Annotations"},
        {value: "online_evaluation", label: "Online Evaluations"},
        {value: "custom_evaluation", label: "SDK Evaluations"},
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
        if (!router.isReady) return

        const allowed = allowedOptionsByScope[scope]
            .filter((option) => !option.disabled)
            .map((option) => option.value)

        // If nothing selected yet, or current selection isn't allowed for this scope,
        // normalize to defaultKey if allowed, otherwise first allowed.
        if (!selectedEvaluation || !allowed.includes(selectedEvaluation)) {
            const fallback = allowed.includes(defaultKey) ? defaultKey : allowed[0]
            if (fallback && fallback !== selectedEvaluation) {
                setSelectedEvaluation(fallback)
            }
        }
    }, [router.isReady, scope, selectedEvaluation, defaultKey, setSelectedEvaluation])

    const options = allowedOptionsByScope[scope]

    useEffect(() => {
        if (!router.isReady) return
        const isSelectable = options.some(
            (option) => option.value === selectedEvaluation && !option.disabled,
        )
        if (selectedEvaluation && selectedEvaluation !== defaultKey && isSelectable) {
            setDefaultKey(selectedEvaluation)
        }
    }, [router.isReady, selectedEvaluation, defaultKey, setDefaultKey, options])

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
            case "online_evaluation":
                return <OnlineEvaluation viewType="evaluation" scope={scope} />
            case "custom_evaluation":
                return <CustomEvaluation viewType="evaluation" scope={scope} />
            case "auto_evaluation":
            default:
                return <AutoEvaluation viewType="evaluation" scope={scope} />
        }
    }, [selectedEvaluation, scope])

    return (
        <div
            className={clsx(classes.container, "grow flex flex-col min-h-0 [&_.ant-tabs-nav]:mb-0")}
        >
            <div className="flex items-center">
                <Typography.Text className={classes.title}>Evaluations</Typography.Text>
            </div>
            <div>
                <Tabs
                    items={options.map((o) => ({
                        label: o.label,
                        key: o.value,
                        disabled: o.disabled,
                    }))}
                    activeKey={selectedEvaluation}
                    onChange={(key) => {
                        if (options.find((option) => option.value === key)?.disabled) return
                        setSelectedEvaluation(key)
                    }}
                />
            </div>

            <div className={clsx("grow flex flex-col min-h-0")}>{renderPage}</div>
        </div>
    )
}

export default EvaluationsView
