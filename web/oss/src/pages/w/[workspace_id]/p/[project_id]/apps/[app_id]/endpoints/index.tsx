// @ts-nocheck
import {useEffect, useState} from "react"

import {ApiOutlined, AppstoreOutlined, HistoryOutlined} from "@ant-design/icons"
import {Alert, Collapse, CollapseProps, Empty, Radio, Tabs, Tooltip, Typography} from "antd"
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
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {
    Environment,
    GenericObject,
    JSSTheme,
    ListAppsItem,
    Parameter,
    Variant,
} from "@/oss/lib/Types"
import {fetchAppContainerURL} from "@/oss/services/api"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"
import {currentAppAtom} from "@/oss/state/app"

const DeploymentHistory: any = dynamic(
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

export const createParams = (
    inputParams: Parameter[] | null,
    environmentName: string,
    value: string | number,
    app?: ListAppsItem | null,
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
    const isChat = app?.app_type === "chat" || hasMessagesParam
    if (isChat) {
        mainParams["messages"] = [
            {
                role: "user",
                content: "",
            },
        ]
        mainParams["inputs"] = secondaryParams
    } else if (Object.keys(secondaryParams).length > 0) {
        mainParams["inputs"] = secondaryParams
    }

    mainParams["environment"] = environmentName
    if (app) {
        mainParams["app"] = app.app_name
    }
    return JSON.stringify(mainParams, null, 2)
}

export default function VariantEndpoint() {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [tab, setTab] = useQueryParam("tab", "overview")
    const isOss = !isDemo()
    const currentApp = useAtomValue(currentAppAtom)

    // Load URL for the given environment
    const [uri, setURI] = useState<string | null>(null)
    const loadURL = async (environment: Environment) => {
        if (environment.deployed_app_variant_id) {
            const url = await fetchAppContainerURL(appId, environment.deployed_app_variant_id)
            setURI(`${url}/run`)
        }
    }

    // Load environments for the given app
    const [selectedEnvironment, setSelectedEnvironment] = useState<Environment | null>(null)
    const {environments} = useEnvironments({
        appId,
        onSuccess: (data: Environment[]) => {
            const loadProductionEnv = data.find((env) => env.name === "production")
            if (loadProductionEnv) {
                setSelectedEnvironment(loadProductionEnv)
                loadURL(loadProductionEnv)
            } else {
                setSelectedEnvironment(data[0])
                loadURL(data[0])
            }
        },
    })

    const handleEnvironmentClick = ({key}: {key: string}) => {
        const chosenEnvironment = environments.find((env) => env.name === key)
        if (!chosenEnvironment) return
        setSelectedEnvironment(chosenEnvironment)
        loadURL(chosenEnvironment)
    }

    const {data, isLoading, error} = useVariants(currentApp)

    const variants = data?.variants

    // Set the variant to the variant deployed in the selected environment
    const [variant, setVariant] = useState<Variant | null>(null)
    useEffect(() => {
        if (!selectedEnvironment) return
        const variant = (variants || []).find(
            (variant) => variant.variantId === selectedEnvironment.deployed_app_variant_revision_id,
        )
        if (!variant) return

        setVariant(variant)
    }, [selectedEnvironment, variants])

    useEffect(() => {
        if (variants && variants.length > 0) {
            setVariant(variants[0])
        }
    }, [variants, appId])

    const {inputParams} = variant || {}

    if (isLoading) {
        return <ResultComponent status={"info"} title="Loading variants..." spinner={true} />
    }
    if (!variant) {
        return <Empty style={{margin: "50px 0"}} description={"No variants available"} />
    }
    if (error) {
        return (
            <ResultComponent status={"error"} title={error?.message || "Error loading variant"} />
        )
    }

    const params = createParams(inputParams, selectedEnvironment?.name || "none", "add_a_value")
    const invokeLlmAppCodeSnippet: Record<string, string> = {
        Python: invokeLlmApppythonCode(uri!, params),
        cURL: invokeLlmAppcURLCode(uri!, params),
        TypeScript: invokeLlmApptsCode(uri!, params),
    }

    const fetchConfigCodeSnippet: Record<string, string> = {
        Python: fetchConfigpythonCode(variant.baseId, selectedEnvironment?.name!),
        cURL: fetchConfigcURLCode(variant.baseId, selectedEnvironment?.name!),
        TypeScript: fetchConfigtsCode(variant.baseId, selectedEnvironment?.name!),
    }

    const items: CollapseProps["items"] = [
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
    ]

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
                    onChange={(e) => handleEnvironmentClick({key: e.target.value})}
                    className={classes.envButtons}
                >
                    {environments
                        .map((env) => (
                            <Radio.Button
                                disabled={!env.deployed_app_variant_id}
                                key={env.name}
                                value={env.name}
                            >
                                {env.name}
                            </Radio.Button>
                        ))
                        .reverse()}
                </Radio.Group>
            </div>

            {selectedEnvironment?.deployed_app_variant_id ? (
                <>
                    <Tabs
                        destroyOnHidden
                        defaultActiveKey={tab}
                        items={[
                            {
                                key: "overview",
                                label: "Overview",
                                icon: <AppstoreOutlined />,
                                children: (
                                    <Collapse accordion defaultActiveKey={["1"]} items={items} />
                                ),
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
                                    <DeploymentHistory selectedEnvironment={selectedEnvironment} />
                                ),
                                disabled: isOss,
                            },
                        ]}
                        onChange={setTab}
                    />
                </>
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
