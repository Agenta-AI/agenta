import {useEffect, useState} from "react"
import {useRouter} from "next/router"

import invokeLlmAppcURLCode from "@/code_snippets/endpoints/invoke_llm_app/curl"
import invokeLlmApppythonCode from "@/code_snippets/endpoints/invoke_llm_app/python"
import invokeLlmApptsCode from "@/code_snippets/endpoints/invoke_llm_app/typescript"
import fetchConfigcURLCode from "@/code_snippets/endpoints/fetch_config/curl"
import fetchConfigpythonCode from "@/code_snippets/endpoints/fetch_config/python"
import fetchConfigtsCode from "@/code_snippets/endpoints/fetch_config/typescript"
import DynamicCodeBlock from "@/components/DynamicCodeBlock/DynamicCodeBlock"
import ResultComponent from "@/components/ResultComponent/ResultComponent"
import {Environment, GenericObject, JSSTheme, ListAppsItem, Parameter, Variant} from "@/lib/Types"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import {fetchAppContainerURL} from "@/services/api"
import {ApiOutlined, AppstoreOutlined, HistoryOutlined} from "@ant-design/icons"
import {Alert, Collapse, CollapseProps, Empty, Radio, Tabs, Tooltip, Typography} from "antd"
import {useQueryParam} from "@/hooks/useQuery"
import {useEnvironments} from "@/services/deployment/hooks/useEnvironments"
import {useVariants} from "@/lib/hooks/useVariants"
import {useAppsData} from "@/contexts/app.context"
import {createUseStyles} from "react-jss"

const DeploymentHistory: any = dynamicComponent("DeploymentHistory/DeploymentHistory")

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
    isChatVariant: boolean | null,
    app: ListAppsItem | null,
) => {
    let mainParams: GenericObject = {}
    let secondaryParams: GenericObject = {}

    inputParams?.forEach((item) => {
        if (item.input) {
            mainParams[item.name] = item.default || value
        } else {
            secondaryParams[item.name] = item.default || value
        }
    })
    if (isChatVariant) {
        mainParams["inputs"] = [
            {
                role: "user",
                content: "Example message",
            },
        ]
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
    const {currentApp} = useAppsData()

    // Load URL for the given environment
    const [uri, setURI] = useState<string | null>(null)
    const loadURL = async (environment: Environment) => {
        if (environment.deployed_app_variant_id) {
            const url = await fetchAppContainerURL(appId, environment.deployed_app_variant_id)
            setURI(`${url}/generate_deployed`)
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

    const {data, isLoading, error} = useVariants(currentApp)({
        appId: currentApp?.app_id,
    })

    const variants = data?.variants

    // Set the variant to the variant deployed in the selected environment
    const [variant, setVariant] = useState<Variant | null>(null)
    useEffect(() => {
        if (!selectedEnvironment) return
        const variant = (variants || []).find(
            (variant) => variant.variantId === selectedEnvironment.deployed_app_variant_id,
        )
        if (!variant) return

        setVariant(variant)
    }, [selectedEnvironment, variants])

    useEffect(() => {
        if (variants && variants.length > 0) {
            setVariant(variants[0])
        }
    }, [variants, appId])

    const {inputParams, isChatVariant} = variant || {}

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

    const params = createParams(
        inputParams,
        selectedEnvironment?.name || "none",
        "add_a_value",
        isChatVariant,
    )
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
        <div className={classes.container} data-cy="endpoints">
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
                        destroyInactiveTabPane
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
                                        title="Deployment History available in Cloud/Enterprise editions only"
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
