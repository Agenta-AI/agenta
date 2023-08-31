import cURLCode from "@/code_snippets/endpoints/curl"
import pythonCode from "@/code_snippets/endpoints/python"
import tsCode from "@/code_snippets/endpoints/typescript"
import DynamicCodeBlock from "@/components/DynamicCodeBlock/DynamicCodeBlock"
import {GenericObject, LanguageItem, Parameter, Variant} from "@/lib/Types"
import {useVariant} from "@/lib/hooks/useVariant"
import {fetchVariants, getAppContainerURL} from "@/lib/services/api"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"

export default function VariantEndpoint() {
    const router = useRouter()
    const appName = router.query.app_name?.toString() || ""

    const [variants, setVariants] = useState<Variant[]>([])

    const [isVariantsLoading, setIsVariantsLoading] = useState(false)
    const [isVariantsError, setIsVariantsError] = useState<boolean | string>(false)
    const [variantURI, setVariantURI] = useState<string | null>(null)
    const [variant, setVariant] = useState<Variant | null>(null)
    const [selectedLanguage, setSelectedLanguage] = useState<LanguageItem | null>(null)

    useEffect(() => {
        const fetchData = async () => {
            setIsVariantsLoading(true)
            try {
                const backendVariants = await fetchVariants(appName)
                if (backendVariants.length > 0) {
                    setVariants(backendVariants)
                    setVariant(backendVariants[0])
                }
                setIsVariantsLoading(false)
            } catch (error) {
                setIsVariantsError("Failed to fetch variants")
                setIsVariantsLoading(false)
            }
        }
        fetchData()
    }, [appName])

    useEffect(() => {
        if (variants.length > 0) {
            setVariant(variants[0])
        }
    }, [variants, appName])

    useEffect(() => {
        const fetchData = async () => {
            try {
                if (appName && variant) {
                    const variantDesignator = variant.templateVariantName ?? variant.variantName
                    const url = await getAppContainerURL(appName, variantDesignator)
                    setVariantURI(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/${url}/generate`)
                }
            } catch (error) {
                console.error("An error occurred:", error)
            }
        }

        fetchData()
    }, [appName, variant])

    const {inputParams, optParams, URIPath, isLoading, isError, error} = useVariant(
        appName,
        variant!,
    )
    const createParams = (
        inputParams: Parameter[] | null,
        optParams: Parameter[] | null,
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

        optParams
            ?.filter((item) => item.type !== "object")
            .forEach((item) => {
                mainParams[item.name] = item.default
            })

        return JSON.stringify(mainParams, null, 2)
    }

    const handleVariantChange = (variantName: string) => {
        const selectedVariant = variants.find((variant) => variant.variantName === variantName)
        if (selectedVariant) {
            setVariant(selectedVariant)
        }
    }

    const handleLanguageChange = (selectedLanguage: LanguageItem) => {
        setSelectedLanguage(selectedLanguage)
    }

    let renderElement = null
    if (isVariantsError) {
        renderElement = <div>Failed to load variants</div>
    } else if (isVariantsLoading) {
        renderElement = <div>Loading variants...</div>
    } else if (!variant) {
        renderElement = <div>No variant available</div>
    } else if (isLoading) {
        renderElement = <div>Loading variant...</div>
    } else if (isError) {
        renderElement = <div>{error?.message || "Error loading variant"}</div>
    } else {
        const params = createParams(inputParams, optParams, "add_a_value")

        const codeSnippets: Record<string, string> = {
            Python: pythonCode(variantURI!, params),
            cURL: cURLCode(variantURI!, params),
            TypeScript: tsCode(variantURI!, params),
        }

        renderElement = (
            <div>
                <DynamicCodeBlock
                    codeSnippets={codeSnippets}
                    includeVariantsDropdown={true}
                    variants={variants}
                    selectedVariant={variant}
                    selectedLanguage={selectedLanguage}
                    onVariantChange={handleVariantChange}
                    onLanguageChange={handleLanguageChange}
                />
            </div>
        )
    }

    return renderElement
}
