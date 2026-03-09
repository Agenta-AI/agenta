import {useCallback, useMemo, useState} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
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
import {EnhancedVariant} from "@/oss/lib/shared/variant/types"
import {DeploymentRevisions} from "@/oss/lib/Types"
import {createParams} from "@/oss/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/endpoints"
import {currentAppAtom, useURI} from "@/oss/state/app"

const ApiKeyInput = dynamic(
    () => import("@/oss/components/pages/app-management/components/ApiKeyInput"),
    {ssr: false},
)

const INVOKE_LLM_URL_PLACEHOLDER = ""

interface UseApiContentProps {
    variants: EnhancedVariant[]
    selectedEnvironment: DeploymentRevisions
    revisionId?: string
    handleOpenSelectDeployVariantModal: () => void
}

const UseApiContent = ({
    variants,
    selectedEnvironment,
    revisionId,
    handleOpenSelectDeployVariantModal,
}: UseApiContentProps) => {
    const appId = useAppId()
    const currentApp = useAtomValue(currentAppAtom)
    const [selectedLang, setSelectedLang] = useState("python")
    const [apiKeyValue, setApiKeyValue] = useState("")

    const latestRevisionId = useMemo(() => {
        if (!Array.isArray(variants) || variants.length === 0) return ""

        const sorted = [...variants].sort((a, b) => {
            const aTs = Number(
                (a as any)?.updatedAtTimestamp ?? (a as any)?.createdAtTimestamp ?? 0,
            )
            const bTs = Number(
                (b as any)?.updatedAtTimestamp ?? (b as any)?.createdAtTimestamp ?? 0,
            )
            return bTs - aTs
        })

        return (sorted[0] as any)?.id ?? ""
    }, [variants])

    const effectiveRevisionId =
        revisionId ||
        selectedEnvironment?.deployed_app_variant_revision_id ||
        latestRevisionId ||
        ""
    const effectiveRevisionData = useAtomValue(
        legacyAppRevisionMolecule.atoms.data(effectiveRevisionId || ""),
    ) as {variantId?: string} | null
    const revisionVariantIdFromList = useMemo(() => {
        const found = (variants || []).find(
            (variant) => (variant as any)?.id === effectiveRevisionId,
        )
        return (found as any)?.variantId ?? null
    }, [effectiveRevisionId, variants])
    const effectiveVariantId =
        effectiveRevisionData?.variantId ||
        revisionVariantIdFromList ||
        selectedEnvironment?.deployed_app_variant_id ||
        undefined
    const {data: uri, isLoading: isUriQueryLoading} = useURI(appId, effectiveVariantId)
    const isLoading = Boolean(effectiveVariantId) && isUriQueryLoading

    const inputPorts = useAtomValue(
        legacyAppRevisionMolecule.atoms.inputPorts(effectiveRevisionId),
    ) as any[]
    const variableNames = useMemo(
        () => (inputPorts || []).map((p: any) => p.key) as string[],
        [inputPorts],
    )

    const params = useMemo(() => {
        const synthesized = variableNames.map((name) => ({name, input: name === "messages"}))

        return createParams(
            synthesized,
            selectedEnvironment?.name || "none",
            "add_a_value",
            currentApp,
        )
    }, [variableNames, selectedEnvironment?.name, currentApp])

    const invokeLlmUrl = (uri && uri.trim()) || INVOKE_LLM_URL_PLACEHOLDER

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
        return (
            <Spin spinning={isLoading}>
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
