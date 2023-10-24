import cURLCode from "@/code_snippets/endpoints/curl"
import pythonCode from "@/code_snippets/endpoints/python"
import tsCode from "@/code_snippets/endpoints/typescript"
import DynamicCodeBlock from "@/components/DynamicCodeBlock/DynamicCodeBlock"
import {Environment, GenericObject, Parameter, Variant} from "@/lib/Types"
import {useVariant} from "@/lib/hooks/useVariant"
import {fetchEnvironments, fetchVariants, getAppContainerURL} from "@/lib/services/api"
import {ApiOutlined, DownOutlined} from "@ant-design/icons"
import {Alert, Button, Dropdown, Space, Typography} from "antd"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"

const {Text, Title} = Typography

const useStyles = createUseStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        rowGap: 20,
    },
})

export default function VariantEndpoint() {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    // Load URL for the given environment
    const [uri, setURI] = useState<string | null>(null)
    const loadURL = async (environment: Environment) => {
        if (environment.deployed_app_variant_id) {
            const url = await getAppContainerURL(appId, environment.deployed_app_variant_id)
            setURI(`${url}/generate_deployed`)
        }
    }

    // Load environments for the given app
    const [selectedEnvironment, setSelectedEnvironment] = useState<Environment | null>(null)
    const [environments, setEnvironments] = useState<Environment[]>([])
    const loadEnvironments = async () => {
        const response: Environment[] = await fetchEnvironments(appId)
        setEnvironments(response)
        setSelectedEnvironment(response[0])

        await loadURL(response[0])
    }
    useEffect(() => {
        if (!appId) return
        loadEnvironments()
    }, [appId])

    const handleEnvironmentClick = ({key}: {key: string}) => {
        const chosenEnvironment = environments.find((env) => env.name === key)
        if (!chosenEnvironment) return
        setSelectedEnvironment(chosenEnvironment)
        loadURL(chosenEnvironment)
    }

    // Initialize variants
    const [variants, setVariants] = useState<Variant[]>([])
    const [isVariantsLoading, setIsVariantsLoading] = useState(false)
    const [isVariantsError, setIsVariantsError] = useState<boolean | string>(false)
    useEffect(() => {
        const fetchData = async () => {
            setIsVariantsLoading(true)
            try {
                const backendVariants = await fetchVariants(appId)
                if (backendVariants.length > 0) {
                    setVariants(backendVariants)
                }
                setIsVariantsLoading(false)
            } catch (error) {
                setIsVariantsError("Failed to fetch variants")
                setIsVariantsLoading(false)
            }
        }
        fetchData()
    }, [appId])

    // Set the variant to the variant deployed in the selected environment
    const [variant, setVariant] = useState<Variant | null>(null)
    useEffect(() => {
        if (!selectedEnvironment) return
        const variant = variants.find(
            (variant) => variant.variantId === selectedEnvironment.deployed_app_variant_id,
        )
        if (!variant) return

        setVariant(variant)
    }, [selectedEnvironment, variants])

    useEffect(() => {
        if (variants.length > 0) {
            setVariant(variants[0])
        }
    }, [variants, appId])

    const {inputParams, optParams, isLoading, isError, error} = useVariant(appId, variant!)
    const createParams = (
        inputParams: Parameter[] | null,
        environmentName: string,
        value: string | number,
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
        if (Object.keys(secondaryParams).length > 0) {
            mainParams["inputs"] = secondaryParams
        }

        mainParams["environment"] = environmentName

        return JSON.stringify(mainParams, null, 2)
    }

    if (isVariantsError) {
        return <div>Failed to load variants</div>
    }
    if (isVariantsLoading) {
        return <div>Loading variants...</div>
    }
    if (!variant) {
        return <div>No variant available</div>
    }
    if (isLoading) {
        return <div>Loading variant...</div>
    }
    if (isError) {
        return <div>{error?.message || "Error loading variant"}</div>
    }

    const params = createParams(inputParams, selectedEnvironment?.name || "none", "add_a_value")
    const codeSnippets: Record<string, string> = {
        Python: pythonCode(uri!, params),
        cURL: cURLCode(uri!, params),
        TypeScript: tsCode(uri!, params),
    }
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
                <Dropdown
                    menu={{
                        items: environments.map((env) => ({label: env.name, key: env.name})),
                        onClick: handleEnvironmentClick,
                    }}
                >
                    <Button size="small">
                        <Space>
                            {selectedEnvironment?.name || "Select a variant"}
                            <DownOutlined />
                        </Space>
                    </Button>
                </Dropdown>
            </div>

            {selectedEnvironment?.deployed_app_variant_id ? (
                <DynamicCodeBlock codeSnippets={codeSnippets} />
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
