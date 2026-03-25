import {useCallback, useMemo, useState} from "react"

import {workflowMolecule, workflowLatestRevisionIdAtomFamily} from "@agenta/entities/workflow"
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
import {useAppId} from "@/oss/hooks/useAppId"
import {createParams} from "@/oss/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/endpoints"
import {currentAppAtom} from "@/oss/state/app"

const ApiKeyInput = dynamic(
    () => import("@/oss/components/pages/app-management/components/ApiKeyInput"),
    {ssr: false},
)

interface UseApiContentProps {
    envName: string
    deployedRevisionId?: string | null
    revisionId?: string
    handleOpenSelectDeployVariantModal: () => void
}

const UseApiContent = ({
    envName,
    deployedRevisionId,
    revisionId,
    handleOpenSelectDeployVariantModal,
}: UseApiContentProps) => {
    const currentApp = useAtomValue(currentAppAtom)
    const appId = useAppId()
    const [selectedLang, setSelectedLang] = useState("python")
    const [apiKeyValue, setApiKeyValue] = useState("")

    // Use workflow entity to get latest revision as fallback
    const latestRevisionId = useAtomValue(workflowLatestRevisionIdAtomFamily(appId || ""))

    const effectiveRevisionId = revisionId || deployedRevisionId || latestRevisionId || ""

    const uri = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.deploymentUrl(effectiveRevisionId || ""),
            [effectiveRevisionId],
        ),
    )

    const inputPorts = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.inputPorts(effectiveRevisionId || ""),
            [effectiveRevisionId],
        ),
    ) as any[]
    const variableNames = useMemo(
        () => (inputPorts || []).map((p: any) => p.key) as string[],
        [inputPorts],
    )

    const params = useMemo(() => {
        const synthesized = variableNames.map((name) => ({name, input: name === "messages"}))

        return createParams(synthesized, envName || "none", "add_a_value", currentApp)
    }, [variableNames, envName, currentApp])

    // deploymentUrl resolves to /run (resolves config from the deployed environment).
    const invokeLlmUrl = useMemo(() => uri?.trim() || "", [uri])

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
                (currentApp?.name ?? currentApp?.slug)!,
                envName!,
                apiKeyValue || "x.xxxxxxxx",
            ),
            bash: fetchConfigcURLCode(
                (currentApp?.name ?? currentApp?.slug)!,
                envName!,
                apiKeyValue || "x.xxxxxxxx",
            ),
            typescript: fetchConfigtsCode(
                (currentApp?.name ?? currentApp?.slug)!,
                envName!,
                apiKeyValue || "x.xxxxxxxx",
            ),
        }),
        [apiKeyValue, currentApp?.name, currentApp?.slug, envName],
    )

    const renderTabChildren = useCallback(() => {
        return (
            <Spin spinning={false}>
                <LanguageCodeBlock
                    fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                    invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                    selectedLang={selectedLang}
                    handleOpenSelectDeployVariantModal={handleOpenSelectDeployVariantModal}
                    invokeLlmUrl={invokeLlmUrl}
                    showDeployOverlay={false}
                />
            </Spin>
        )
    }, [
        fetchConfigCodeSnippet,
        handleOpenSelectDeployVariantModal,
        invokeLlmAppCodeSnippet,
        invokeLlmUrl,
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
            <div className="p-4">
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
