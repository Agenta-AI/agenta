import {useCallback, useMemo, useState} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
    workflowVariantsListQueryStateAtomFamily,
} from "@agenta/entities/workflow"
import {ApiOutlined, AppstoreOutlined, HistoryOutlined} from "@ant-design/icons"
import {
    Alert,
    Collapse,
    type CollapseProps,
    Empty,
    Radio,
    type RadioChangeEvent,
    Tabs,
    Tooltip,
    Typography,
} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import fetchConfigcURLCode from "@/oss/code_snippets/endpoints/fetch_config/curl"
import fetchConfigpythonCode from "@/oss/code_snippets/endpoints/fetch_config/python"
import fetchConfigtsCode from "@/oss/code_snippets/endpoints/fetch_config/typescript"
import invokeLlmAppcURLCode from "@/oss/code_snippets/endpoints/invoke_llm_app/curl"
import invokeLlmApppythonCode from "@/oss/code_snippets/endpoints/invoke_llm_app/python"
import invokeLlmApptsCode from "@/oss/code_snippets/endpoints/invoke_llm_app/typescript"
import DynamicCodeBlock from "@/oss/components/DynamicCodeBlock/DynamicCodeBlock"
import ResultComponent from "@/oss/components/ResultComponent/ResultComponent"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {isDemo} from "@/oss/lib/helpers/utils"
import type {GenericObject, JSSTheme, Parameter} from "@/oss/lib/Types"
import {useCurrentApp} from "@/oss/state/app/hooks"
import {useAppEnvironments} from "@/oss/state/environment/useAppEnvironments"

const DeploymentHistory = dynamic(
    () => import("@/oss/components/DeploymentHistory/DeploymentHistory"),
)

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        rowGap: 20,
    },
    envButtons: {
        "& .ant-radio-button-wrapper-checked": {
            backgroundColor: theme.colorPrimary,
            color: theme.colorWhite,
            "&:hover": {
                color: theme.colorWhite,
            },
        },
    },
}))

const {Text, Title} = Typography

/**
 * Build example params JSON from a JSON Schema input definition.
 * Uses the entity's is_chat flag for chat detection.
 */
const createParamsFromSchema = (
    inputSchema: Record<string, unknown> | null,
    environmentName: string,
    isChat: boolean,
    appName: string | null,
): string => {
    const mainParams: GenericObject = {}

    if (inputSchema) {
        const properties = inputSchema.properties as Record<string, unknown> | undefined
        if (properties) {
            for (const [key, schemaDef] of Object.entries(properties)) {
                const schema = schemaDef as Record<string, unknown> | undefined
                mainParams[key] = schema?.default ?? "add_a_value"
            }
        }
    }

    if (isChat) {
        mainParams["messages"] = [{role: "user", content: ""}]
    }

    mainParams["environment"] = environmentName
    if (appName) {
        mainParams["app"] = appName
    }
    return JSON.stringify(mainParams, null, 2)
}

/**
 * Build example params JSON from synthesized Parameter[] + environment name.
 * Used by DeploymentDrawer and UseApiContent for environment-based code snippets.
 */
export const createParams = (
    inputParams: Parameter[] | null,
    environmentName: string,
    value: string | number,
    app?: {name?: string | null; slug?: string; flags?: {is_chat?: boolean}} | null,
) => {
    const mainParams: GenericObject = {}
    const secondaryParams: GenericObject = {}

    inputParams?.forEach((item) => {
        if (item.input) {
            mainParams[item.name] = item.default || value
        } else {
            secondaryParams[item.name] = item.default || value
        }
    })
    const hasMessagesParam = Array.isArray(inputParams)
        ? inputParams.some((p) => p?.name === "messages")
        : false
    const isChat = !!app?.flags?.is_chat || hasMessagesParam
    if (isChat) {
        mainParams["messages"] = [{role: "user", content: ""}]
        mainParams["inputs"] = secondaryParams
    } else if (Object.keys(secondaryParams).length > 0) {
        mainParams["inputs"] = secondaryParams
    }

    mainParams["environment"] = environmentName
    if (app) {
        mainParams["app"] = app.name ?? app.slug
    }
    return JSON.stringify(mainParams, null, 2)
}

export default function VariantEndpoint() {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [tab, setTab] = useQueryParam("tab", "overview")
    const isOss = !isDemo()
    const currentApp = useCurrentApp()

    // Load environments for the given app
    const [selectedEnvironment, setSelectedEnvironment] = useState<AppEnvironmentDeployment | null>(
        null,
    )

    const onEnvironmentsLoaded = useCallback((data: AppEnvironmentDeployment[]) => {
        const productionEnv = data.find((env) => env.name === "production")
        setSelectedEnvironment(productionEnv ?? data[0] ?? null)
    }, [])

    const {environments} = useAppEnvironments({
        appId,
        onSuccess: onEnvironmentsLoaded,
    })

    const handleEnvironmentClick = useCallback(
        ({key}: {key: string}) => {
            const chosenEnvironment = environments.find((env) => env.name === key)
            if (!chosenEnvironment) return
            setSelectedEnvironment(chosenEnvironment)
        },
        [environments],
    )

    // Resolve deployed revision ID and use entity atoms for URL + schema
    const deployedRevisionId = selectedEnvironment?.deployedRevisionId ?? ""

    const invocationUrl = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.invocationUrl(deployedRevisionId),
            [deployedRevisionId],
        ),
    )
    const inputSchema = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.inputSchema(deployedRevisionId),
            [deployedRevisionId],
        ),
    )
    const isChat = useAtomValue(
        useMemo(() => workflowMolecule.selectors.isChat(deployedRevisionId), [deployedRevisionId]),
    )

    // Check if there are any variants at all
    const variants = useAtomValue(
        useMemo(() => workflowVariantsListDataAtomFamily(appId || ""), [appId]),
    )
    const isLoading = useAtomValue(
        useMemo(() => workflowVariantsListQueryStateAtomFamily(appId || ""), [appId]),
    ).isPending

    const hasVariants = (variants?.length ?? 0) > 0

    // Build code snippet params
    const invokeLlmUrl = useMemo(() => {
        if (!invocationUrl) return ""
        // The invocationUrl from the atom resolves to /test endpoint.
        // For the /run endpoint, replace /test suffix with /run.
        return invocationUrl.replace(/\/test$/, "/run")
    }, [invocationUrl])

    const params = useMemo(
        () =>
            createParamsFromSchema(
                inputSchema,
                selectedEnvironment?.name || "none",
                isChat,
                currentApp?.name ?? currentApp?.slug ?? null,
            ),
        [inputSchema, selectedEnvironment?.name, isChat, currentApp?.name, currentApp?.slug],
    )

    const appSlug = currentApp?.name ?? currentApp?.slug ?? ""

    const invokeLlmAppCodeSnippet = useMemo<Record<string, string>>(
        () => ({
            Python: invokeLlmApppythonCode(invokeLlmUrl, params, ""),
            cURL: invokeLlmAppcURLCode(invokeLlmUrl, params, ""),
            TypeScript: invokeLlmApptsCode(invokeLlmUrl, params, ""),
        }),
        [invokeLlmUrl, params],
    )

    const fetchConfigCodeSnippet = useMemo<Record<string, string>>(
        () => ({
            Python: fetchConfigpythonCode(appSlug, selectedEnvironment?.name ?? "", ""),
            cURL: fetchConfigcURLCode(appSlug, selectedEnvironment?.name ?? "", ""),
            TypeScript: fetchConfigtsCode(appSlug, selectedEnvironment?.name ?? "", ""),
        }),
        [appSlug, selectedEnvironment?.name],
    )

    const collapseItems = useMemo<CollapseProps["items"]>(
        () => [
            {
                key: "1",
                label: "Invoke LLM App",
                children: <DynamicCodeBlock codeSnippets={invokeLlmAppCodeSnippet} />,
            },
            {
                key: "2",
                label: "Fetch Prompt/Config",
                children: <DynamicCodeBlock codeSnippets={fetchConfigCodeSnippet} />,
            },
        ],
        [invokeLlmAppCodeSnippet, fetchConfigCodeSnippet],
    )

    const handleRadioChange = useCallback(
        (e: RadioChangeEvent) => handleEnvironmentClick({key: e.target.value}),
        [handleEnvironmentClick],
    )

    const tabItems = useMemo(
        () => [
            {
                key: "overview",
                label: "Overview",
                icon: <AppstoreOutlined />,
                children: <Collapse accordion defaultActiveKey={["1"]} items={collapseItems} />,
            },
            {
                key: "history",
                label: !isOss ? (
                    "History"
                ) : (
                    <Tooltip
                        placement="right"
                        title="Deployment History available in Cloud/EE only"
                    >
                        History
                    </Tooltip>
                ),
                icon: <HistoryOutlined />,
                children: (
                    <DeploymentHistory
                        environmentSlug={selectedEnvironment?.name ?? ""}
                        appId={appId}
                    />
                ),
                disabled: isOss,
            },
        ],
        [collapseItems, isOss, selectedEnvironment?.name, appId],
    )

    if (isLoading) {
        return <ResultComponent status={"info"} title="Loading variants..." spinner={true} />
    }
    if (!hasVariants) {
        return <Empty style={{margin: "50px 0"}} description={"No variants available"} />
    }

    return (
        <div className={classes.container}>
            <Title level={3}>
                <ApiOutlined />
                API endpoint
            </Title>
            <Text>
                Select an environment then use this endpoint to send requests to the LLM app.
            </Text>

            <div>
                <Text>Environment: </Text>
                <Radio.Group
                    value={selectedEnvironment?.name}
                    onChange={handleRadioChange}
                    className={classes.envButtons}
                >
                    {environments
                        .map((env) => (
                            <Radio.Button
                                disabled={!env.deployedVariantId}
                                key={env.name}
                                value={env.name}
                            >
                                {env.name}
                            </Radio.Button>
                        ))
                        .reverse()}
                </Radio.Group>
            </div>

            {selectedEnvironment?.deployedVariantId ? (
                <Tabs destroyOnHidden defaultActiveKey={tab} items={tabItems} onChange={setTab} />
            ) : (
                <Alert
                    message="Publish Required"
                    description={`No variants have been published to ${selectedEnvironment?.name} environment. Please publish a variant from the playground to proceed`}
                    type="warning"
                    showIcon
                />
            )}
        </div>
    )
}
