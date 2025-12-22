import {useCallback, useMemo, useState} from "react"

import {PythonOutlined} from "@ant-design/icons"
import {CloudArrowUp, FileCode, FileTs} from "@phosphor-icons/react"
import {Button, Spin, Tabs, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import fetchConfigcURLCode from "@/oss/code_snippets/endpoints/fetch_config/curl"
import fetchConfigpythonCode from "@/oss/code_snippets/endpoints/fetch_config/python"
import fetchConfigtsCode from "@/oss/code_snippets/endpoints/fetch_config/typescript"
import invokeLlmAppcURLCode from "@/oss/code_snippets/endpoints/invoke_llm_app/curl"
import invokeLlmApppythonCode from "@/oss/code_snippets/endpoints/invoke_llm_app/python"
import invokeLlmApptsCode from "@/oss/code_snippets/endpoints/invoke_llm_app/typescript"
import LanguageCodeBlock from "@/oss/components/pages/overview/deployments/DeploymentDrawer/assets/LanguageCodeBlock"
import {useAppId} from "@/oss/hooks/useAppId"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {DeploymentRevisions} from "@/oss/lib/Types"
import {createParams} from "@/oss/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/endpoints"
import {currentAppAtom, useURI} from "@/oss/state/app"
import {stablePromptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {deployedRevisionByEnvironmentAtomFamily} from "@/oss/state/variant/atoms/fetcher"

const ApiKeyInput = dynamic(
    () => import("@/oss/components/pages/app-management/components/ApiKeyInput"),
    {ssr: false},
)

interface UseApiContentProps {
    variants: EnhancedVariant[]
    selectedEnvironment: DeploymentRevisions
    revisionId?: string
    handleOpenSelectDeployVariantModal: () => void
}

const UseApiContent = ({
    selectedEnvironment,
    revisionId,
    handleOpenSelectDeployVariantModal,
}: UseApiContentProps) => {
    const appId = useAppId()
    const currentApp = useAtomValue(currentAppAtom)
    const [selectedLang, setSelectedLang] = useState("python")
    const [apiKeyValue, setApiKeyValue] = useState("")

    const hasDeployment = Boolean(selectedEnvironment?.deployed_app_variant_id)
    const variantId = hasDeployment ? selectedEnvironment.deployed_app_variant_id : undefined
    const {data: uri, isLoading: isUriQueryLoading} = useURI(appId, variantId)
    const isLoading = Boolean(variantId) && isUriQueryLoading

    const latestRevisionForVariant = useAtomValue(
        deployedRevisionByEnvironmentAtomFamily(selectedEnvironment.name),
    ) as any
    const variableNames = useAtomValue(
        stablePromptVariablesAtomFamily(revisionId || latestRevisionForVariant?.id || ""),
    ) as string[]

    const params = useMemo(() => {
        const synthesized = variableNames.map((name) => ({name, input: name === "messages"}))

        return createParams(
            synthesized,
            selectedEnvironment?.name || "none",
            "add_a_value",
            currentApp,
        )
    }, [variableNames, selectedEnvironment?.name, currentApp])

    const invokeLlmUrl = uri ?? ""

    const invokeLlmAppCodeSnippet = useMemo(
        () => ({
            python: invokeLlmApppythonCode(invokeLlmUrl, params, apiKeyValue || "x.xxxxxxxx"),
            bash: invokeLlmAppcURLCode(invokeLlmUrl, params, apiKeyValue || "x.xxxxxxxx"),
            typescript: invokeLlmApptsCode(invokeLlmUrl, params, apiKeyValue || "x.xxxxxxxx"),
        }),
        [apiKeyValue, invokeLlmUrl, params],
    )

    const fetchConfigCodeSnippet = useMemo(
        () => ({
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
        }),
        [apiKeyValue, currentApp?.app_name, selectedEnvironment?.name],
    )

    const renderTabChildren = useCallback(() => {
        if (!hasDeployment) {
            return (
                <div className="flex flex-col items-center gap-4 py-16 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50">
                        <CloudArrowUp size={24} className="text-primary-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Typography.Text className="text-base font-medium">
                            No deployment yet
                        </Typography.Text>
                        <Typography.Text type="secondary">
                            Deploy a variant to generate API credentials and client snippets for
                            this environment.
                        </Typography.Text>
                    </div>
                    <Button
                        type="primary"
                        icon={<CloudArrowUp size={16} />}
                        onClick={handleOpenSelectDeployVariantModal}
                    >
                        Deploy variant
                    </Button>
                </div>
            )
        }

        return (
            <Spin spinning={isLoading}>
                <LanguageCodeBlock
                    fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                    invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                    selectedLang={selectedLang}
                    handleOpenSelectDeployVariantModal={handleOpenSelectDeployVariantModal}
                    invokeLlmUrl={invokeLlmUrl}
                />
            </Spin>
        )
    }, [
        apiKeyValue,
        fetchConfigCodeSnippet,
        handleOpenSelectDeployVariantModal,
        hasDeployment,
        invokeLlmAppCodeSnippet,
        invokeLlmUrl,
        isLoading,
        selectedLang,
    ])

    const tabItems = useMemo(
        () => [
            {
                key: "python",
                label: "Python",
                children: renderTabChildren(),
                icon: <PythonOutlined />,
            },
            {
                key: "typescript",
                label: "TypeScript",
                children: renderTabChildren(),
                icon: <FileTs size={14} />,
            },
            {
                key: "bash",
                label: "cURL",
                children: renderTabChildren(),
                icon: <FileCode size={14} />,
            },
        ],
        [renderTabChildren],
    )

    return (
        <div>
            <div>
                <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />
            </div>
            <Tabs
                destroyOnHidden
                defaultActiveKey={selectedLang}
                items={tabItems}
                onChange={setSelectedLang}
            />
        </div>
    )
}

export default UseApiContent
