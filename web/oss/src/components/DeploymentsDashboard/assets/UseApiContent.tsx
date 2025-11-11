import {useMemo, useState} from "react"

import {PythonOutlined} from "@ant-design/icons"
import {FileCode, FileTs} from "@phosphor-icons/react"
import {Tabs} from "antd"
import dynamic from "next/dynamic"

import fetchConfigcURLCode from "@/oss/code_snippets/endpoints/fetch_config/curl"
import fetchConfigpythonCode from "@/oss/code_snippets/endpoints/fetch_config/python"
import fetchConfigtsCode from "@/oss/code_snippets/endpoints/fetch_config/typescript"
import invokeLlmAppcURLCode from "@/oss/code_snippets/endpoints/invoke_llm_app/curl"
import invokeLlmApppythonCode from "@/oss/code_snippets/endpoints/invoke_llm_app/python"
import invokeLlmApptsCode from "@/oss/code_snippets/endpoints/invoke_llm_app/typescript"
import LanguageCodeBlock from "@/oss/components/pages/overview/deployments/DeploymentDrawer/assets/LanguageCodeBlock"
import useURI from "@/oss/components/pages/overview/deployments/DeploymentDrawer/hooks/useURI"
import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {DeploymentRevisions} from "@/oss/lib/Types"
import {createParams} from "@/oss/pages/apps/[app_id]/endpoints"

const ApiKeyInput = dynamic(
    () => import("@/oss/components/pages/app-management/components/ApiKeyInput"),
    {ssr: false},
)

interface UseApiContentProps {
    variants: EnhancedVariant[]
    selectedEnvironment: DeploymentRevisions
}

const UseApiContent = ({selectedEnvironment, variants}: UseApiContentProps) => {
    const appId = useAppId()
    const {currentApp} = useAppsData()
    const [selectedLang, setSelectedLang] = useState("python")
    const [apiKeyValue, setApiKeyValue] = useState("")

    const {data: uri} = useURI(appId, selectedEnvironment.deployed_app_variant_id || "")

    const params = useMemo(() => {
        const _variant: any = (variants || []).find(
            (item) =>
                (item?.id || item?.variantId) ===
                selectedEnvironment?.deployed_app_variant_revision_id,
        )
        const {inputParams, isChatVariant} = _variant || {}

        const params = createParams(
            inputParams,
            selectedEnvironment?.name || "none",
            "add_a_value",
            isChatVariant,
            currentApp,
        )

        return params
    }, [
        variants,
        currentApp,
        selectedEnvironment?.deployed_app_variant_revision_id,
        selectedEnvironment?.name,
    ])

    const invokeLlmAppCodeSnippet: Record<string, string> = {
        python: invokeLlmApppythonCode(uri!, params, apiKeyValue || "x.xxxxxxxx"),
        bash: invokeLlmAppcURLCode(uri!, params, apiKeyValue || "x.xxxxxxxx"),
        typescript: invokeLlmApptsCode(uri!, params, apiKeyValue || "x.xxxxxxxx"),
    }

    const fetchConfigCodeSnippet: Record<string, string> = {
        python: fetchConfigpythonCode(
            currentApp?.app_name!,
            selectedEnvironment?.name!,
            apiKeyValue || "x.xxxxxxxx",
        ),
        bash: fetchConfigcURLCode(
            currentApp?.app_name!,
            selectedEnvironment?.name!,
            apiKeyValue || "x.xxxxxxxx",
        ),
        typescript: fetchConfigtsCode(
            currentApp?.app_name!,
            selectedEnvironment?.name!,
            apiKeyValue || "x.xxxxxxxx",
        ),
    }

    return (
        <Tabs
            destroyInactiveTabPane
            defaultActiveKey={selectedLang}
            items={[
                {
                    key: "python",
                    label: "Python",
                    children: (
                        <div className="flex flex-col gap-6">
                            <ApiKeyInput
                                apiKeyValue={apiKeyValue}
                                onApiKeyChange={setApiKeyValue}
                            />
                            <LanguageCodeBlock
                                fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                selectedLang={selectedLang}
                            />
                        </div>
                    ),
                    icon: <PythonOutlined />,
                },
                {
                    key: "typescript",
                    label: "TypeScript",
                    children: (
                        <div className="flex flex-col gap-6">
                            <ApiKeyInput
                                apiKeyValue={apiKeyValue}
                                onApiKeyChange={setApiKeyValue}
                            />
                            <LanguageCodeBlock
                                fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                selectedLang={selectedLang}
                            />
                        </div>
                    ),
                    icon: <FileTs size={14} />,
                },
                {
                    key: "bash",
                    label: "cURL",
                    children: (
                        <div className="flex flex-col gap-6">
                            <ApiKeyInput
                                apiKeyValue={apiKeyValue}
                                onApiKeyChange={setApiKeyValue}
                            />
                            <LanguageCodeBlock
                                fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                selectedLang={selectedLang}
                            />
                        </div>
                    ),
                    icon: <FileCode size={14} />,
                },
            ]}
            onChange={setSelectedLang}
        />
    )
}

export default UseApiContent
