import {useEffect, useMemo, useCallback} from "react"
import {ChartDonut, ListChecks, TestTube} from "@phosphor-icons/react"
import {Tabs, TabsProps, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"

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

import {useQueryParam} from "@/oss/hooks/useQuery"
import {JSSTheme} from "@/oss/lib/Types"

import "@ag-grid-community/styles/ag-grid.css"
import "@ag-grid-community/styles/ag-theme-alpine.css"

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
    evaluationTabContainer: {
        "& .ant-tabs-nav": {
            marginBottom: theme.marginLG,
        },
        "& .ant-tabs-tab-btn": {
            display: "flex",
            alignItems: "center",
            "& .ant-tabs-tab-icon": {
                display: "flex",
            },
        },
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

    const handleTabChange = useCallback(
        (key: string) => {
            setSelectedEvaluation(key)
        },
        [setSelectedEvaluation],
    )

    const items: TabsProps["items"] = useMemo(
        () => [
            {
                key: "auto_evaluation",
                label: "Automatic Evaluation",
                icon: <ChartDonut size={16} />,
                children: <AutoEvaluation />,
            },
            {
                key: "human_annotation",
                label: "Human annotation",
                icon: <ListChecks size={16} />,
                children: <SingleModelEvaluation viewType="evaluation" />,
            },
            {
                key: "human_ab_testing",
                label: "Human A/B Testing",
                icon: <TestTube size={16} />,
                children: <AbTestingEvaluation viewType="evaluation" />,
            },
        ],
        [],
    )

    const isAnnotation = router.query.selectedEvaluation === "human_annotation"

    return (
        <div
            className={clsx(classes.container, {
                "grow flex flex-col min-h-0": isAnnotation,
            })}
        >
            <Typography.Text className={classes.title}>Evaluations</Typography.Text>

            <Tabs
                className={classes.evaluationTabContainer}
                rootClassName={clsx([
                    "grow min-h-0 max-h-full [&_.ant-tabs-content-holder]:flex [&_.ant-tabs-content-holder]:flex-col",
                    "[&_.ant-tabs]:flex [&_.ant-tabs]:flex-col [&_.ant-tabs]:grow [&_.ant-tabs]:min-h-0 ",
                    {
                        "[&_.ant-tabs-content-holder]:h-full [&_.ant-tabs-content-holder]:flex [&_.ant-tabs-content-holder]:flex-col":
                            isAnnotation,
                        "[&_.ant-tabs-content]:grow [&_.ant-tabs-content]:min-h-0 [&_.ant-tabs-content]:h-full [&_.ant-tabs-content]:flex [&_.ant-tabs-content]:flex-col":
                            isAnnotation,
                        "[&_.ant-tabs-tabpane-active]:grow [&_.ant-tabs-tabpane-active]:min-h-0 [&_.ant-tabs-tabpane-active]:h-full [&_.ant-tabs-tabpane-active]:flex [&_.ant-tabs-tabpane-active]:flex-col":
                            isAnnotation,
                    },
                ])}
                items={items}
                defaultActiveKey={defaultKey}
                activeKey={selectedEvaluation}
                onChange={handleTabChange}
            />
        </div>
    )
}

export default EvaluationsPage
