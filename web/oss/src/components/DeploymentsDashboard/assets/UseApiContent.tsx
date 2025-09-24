import {useMemo, useState} from "react"

import {PythonOutlined} from "@ant-design/icons"
import {FileCode, FileTs} from "@phosphor-icons/react"
import {Spin, Tabs} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import fetchConfigcURLCode from "@/oss/code_snippets/endpoints/fetch_config/curl"
import fetchConfigpythonCode from "@/oss/code_snippets/endpoints/fetch_config/python"
import fetchConfigtsCode from "@/oss/code_snippets/endpoints/fetch_config/typescript"
import invokeLlmAppcURLCode from "@/oss/code_snippets/endpoints/invoke_llm_app/curl"
import invokeLlmApppythonCode from "@/oss/code_snippets/endpoints/invoke_llm_app/python"
import invokeLlmApptsCode from "@/oss/code_snippets/endpoints/invoke_llm_app/typescript"
import LanguageCodeBlock from "@/oss/components/pages/overview/deployments/DeploymentDrawer/assets/LanguageCodeBlock"
import useURI from "@/oss/components/pages/overview/deployments/DeploymentDrawer/hooks/useURI"
import {useAppId} from "@/oss/hooks/useAppId"
import useStatelessVariants from "@/oss/lib/hooks/useStatelessVariants"
import {extractInputKeysFromSchema} from "@/oss/lib/shared/variant/inputHelpers"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {DeploymentRevisions} from "@/oss/lib/Types"
import {createParams} from "@/oss/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/endpoints"
import {currentAppAtom} from "@/oss/state/app"

const ApiKeyInput = dynamic(
    () => import("@/oss/components/pages/app-management/components/ApiKeyInput"),
    {ssr: false},
)

interface UseApiContentProps {
    variants: EnhancedVariant[]
    selectedEnvironment: DeploymentRevisions
    handleOpenSelectDeployVariantModal: () => void
}

const UseApiContent = ({
    selectedEnvironment,
    variants,
    handleOpenSelectDeployVariantModal,
}: UseApiContentProps) => {
    const appId = useAppId()
    const currentApp = useAtomValue(currentAppAtom)
    const [selectedLang, setSelectedLang] = useState("python")
    const [apiKeyValue, setApiKeyValue] = useState("")

    const {data: uri, isLoading} = useURI(appId, selectedEnvironment.deployed_app_variant_id || "")

    const {specMap, uriMap} = useStatelessVariants()

    const params = useMemo(() => {
        // Derive keys from OpenAPI schema using app-level spec/uri maps
        const vId =
            selectedEnvironment?.deployed_app_variant_id ||
            selectedEnvironment?.deployed_app_variant_revision_id
        const spec = (vId && (specMap?.[vId] as any)) || undefined
        const routePath = (vId && uriMap?.[vId]?.routePath) || ""
        const inputKeys = spec ? extractInputKeysFromSchema(spec, routePath) : []
        const synthesized = inputKeys.map((name) => ({name, input: name === "messages"}))

        return createParams(
            synthesized,
            selectedEnvironment?.name || "none",
            "add_a_value",
            currentApp,
        )
    }, [
        specMap,
        uriMap,
        selectedEnvironment?.deployed_app_variant_id,
        selectedEnvironment?.deployed_app_variant_revision_id,
        selectedEnvironment?.name,
        currentApp,
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
            destroyOnHidden
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
                            <Spin spinning={isLoading}>
                                <LanguageCodeBlock
                                    fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                    invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                    selectedLang={selectedLang}
                                    handleOpenSelectDeployVariantModal={
                                        handleOpenSelectDeployVariantModal
                                    }
                                    invokeLlmUrl={uri}
                                />
                            </Spin>
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
                            <Spin spinning={isLoading}>
                                <LanguageCodeBlock
                                    fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                    invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                    selectedLang={selectedLang}
                                    handleOpenSelectDeployVariantModal={
                                        handleOpenSelectDeployVariantModal
                                    }
                                    invokeLlmUrl={uri}
                                />
                            </Spin>
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
                            <Spin spinning={isLoading}>
                                <LanguageCodeBlock
                                    fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                    invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                    selectedLang={selectedLang}
                                    handleOpenSelectDeployVariantModal={
                                        handleOpenSelectDeployVariantModal
                                    }
                                    invokeLlmUrl={uri}
                                />
                            </Spin>
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
