import {useEffect, useMemo} from "react"

import {Radio, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {JSSTheme} from "@/oss/lib/Types"

const AbTestingEvaluation = dynamic(
    () => import("@/oss/components/HumanEvaluations/AbTestingEvaluation"),
    {ssr: false},
)
const SingleModelEvaluation = dynamic(
    () => import("@/oss/components/HumanEvaluations/SingleModelEvaluation"),
    {ssr: false},
)
const AutoEvaluation = dynamic(
    () => import("@/oss/components/pages/evaluations/autoEvaluation/AutoEvaluation"),
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

const EvaluationsPage = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const uniqueAppId = useMemo(() => {
        const chunksOfAppId = appId.split("-")
        return chunksOfAppId[chunksOfAppId.length - 1]
    }, [appId])

    const [defaultKey, setDefaultKey] = useLocalStorage(
        `${uniqueAppId}-last-visited-evaluation`,
        "auto_evaluation",
    )
    const [selectedEvaluation, setSelectedEvaluation] = useQueryParam(
        "selectedEvaluation",
        defaultKey,
    )

    // Set query param to defaultKey only if it wasn't already set
    useEffect(() => {
        if (!selectedEvaluation || !router.query.selectedEvaluation) {
            setSelectedEvaluation(defaultKey)
        }
    }, [selectedEvaluation, defaultKey, setSelectedEvaluation])

    // Update localStorage only when the selectedEvaluation changes and is different
    useEffect(() => {
        if (selectedEvaluation && selectedEvaluation !== defaultKey) {
            setDefaultKey(selectedEvaluation)
        }
    }, [selectedEvaluation, defaultKey, setDefaultKey])

    // breadcrumbs
    useBreadcrumbsEffect(
        {
            breadcrumbs: {
                appPage: {label: selectedEvaluation.replaceAll("_", " ")},
            },
            type: "append",
            condition: !!selectedEvaluation,
        },
        [selectedEvaluation, router.asPath],
    )

    const renderPages = useMemo(() => {
        switch (selectedEvaluation) {
            case "auto_evaluation":
                return <AutoEvaluation viewType="evaluation" />
            case "human_annotation":
                return <SingleModelEvaluation viewType="evaluation" />
            case "human_ab_testing":
                return <AbTestingEvaluation viewType="evaluation" />
            default:
                return <AutoEvaluation viewType="evaluation" />
        }
    }, [selectedEvaluation])
    const isAnnotation = router.query.selectedEvaluation === "human_annotation"

    return (
        <div
            className={clsx(classes.container, {
                "grow flex flex-col min-h-0": isAnnotation,
            })}
        >
            <div className="flex items-center gap-4">
                <Typography.Text className={classes.title}>Evaluations</Typography.Text>
                <Radio.Group
                    optionType="button"
                    value={selectedEvaluation}
                    onChange={(e) => setSelectedEvaluation(e.target.value)}
                >
                    <Radio.Button value="auto_evaluation">Automatic</Radio.Button>
                    <Radio.Button value="human_annotation">Human annotation</Radio.Button>
                    <Radio.Button value="human_ab_testing">A/B Testing</Radio.Button>
                </Radio.Group>
            </div>

            <div
                className={clsx("grow min-h-0", {
                    "flex flex-col": selectedEvaluation === "human_annotation",
                })}
            >
                {renderPages}
            </div>
        </div>
    )
}

export default EvaluationsPage
