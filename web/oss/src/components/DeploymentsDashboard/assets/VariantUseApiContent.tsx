import {useCallback, useEffect, useMemo, useState} from "react"

import {
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
    workflowRevisionsListDataAtomFamily,
    workflowRevisionsByWorkflowListDataAtomFamily,
} from "@agenta/entities/workflow"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {PythonOutlined} from "@ant-design/icons"
import {FileCode, FileTs} from "@phosphor-icons/react"
import {Spin, Tabs, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {buildCurlSnippet} from "@/oss/code_snippets/endpoints/fetch_variant/curl"
import {buildPythonSnippet} from "@/oss/code_snippets/endpoints/fetch_variant/python"
import {buildTypescriptSnippet} from "@/oss/code_snippets/endpoints/fetch_variant/typescript"
import invokeLlmAppcURLCode from "@/oss/code_snippets/endpoints/invoke_llm_app/curl"
import invokeLlmApppythonCode from "@/oss/code_snippets/endpoints/invoke_llm_app/python"
import invokeLlmApptsCode from "@/oss/code_snippets/endpoints/invoke_llm_app/typescript"
import LanguageCodeBlock from "@/oss/components/pages/overview/deployments/DeploymentDrawer/assets/LanguageCodeBlock"
import SelectVariant from "@/oss/components/Playground/Components/Menus/SelectVariant"
import {useAppId} from "@/oss/hooks/useAppId"
import {currentAppAtom} from "@/oss/state/app"

const ApiKeyInput = dynamic(
    () => import("@/oss/components/pages/app-management/components/ApiKeyInput"),
    {ssr: false},
)

interface VariantUseApiContentProps {
    initialRevisionId?: string
}

const VariantUseApiContent = ({initialRevisionId}: VariantUseApiContentProps) => {
    const appId = useAppId()
    const variants = useAtomValue(workflowVariantsListDataAtomFamily(appId || ""))
    const revisionList = useAtomValue(workflowRevisionsByWorkflowListDataAtomFamily(appId || ""))
    const currentApp = useAtomValue(currentAppAtom)

    const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>()
    const [selectedRevisionId, setSelectedRevisionId] = useState<string | undefined>()
    const [selectedLang, setSelectedLang] = useState("python")
    const [apiKeyValue, setApiKeyValue] = useState("")

    // Get invocation URL and input ports from workflow molecule
    const uri = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.deploymentUrl(selectedRevisionId || ""),
            [selectedRevisionId],
        ),
    )
    const isLoading = false

    const inputPorts = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.inputPorts(selectedRevisionId || ""),
            [selectedRevisionId],
        ),
    ) as any[]
    const variableNames = useMemo(
        () => (inputPorts || []).map((p: any) => p.key) as string[],
        [inputPorts],
    )

    const initialRevision = useMemo(
        () => revisionList.find((rev) => rev.id === initialRevisionId),
        [initialRevisionId, revisionList],
    )

    useEffect(() => {
        if (initialRevision?.workflow_variant_id) {
            setSelectedVariantId(initialRevision.workflow_variant_id)
            setSelectedRevisionId(initialRevision.id)
            return
        }

        if (!selectedVariantId && variants.length) {
            setSelectedVariantId(variants[0]?.id)
        }
    }, [initialRevision, selectedVariantId, variants])

    const variantRevisionsAtom = useMemo(
        () => workflowRevisionsListDataAtomFamily(selectedVariantId || ""),
        [selectedVariantId],
    )

    const variantRevisions = useAtomValue(variantRevisionsAtom)
    const latestRevision = useMemo(() => {
        if (!Array.isArray(variantRevisions) || variantRevisions.length === 0) return null
        // Already sorted by version desc from the atom family
        return variantRevisions[0]
    }, [variantRevisions])

    useEffect(() => {
        if (!selectedVariantId) return

        const hasSelectedRevision =
            selectedRevisionId &&
            (variantRevisions || []).some((rev) => rev.id === selectedRevisionId)

        if (hasSelectedRevision) return

        const nextRevisionId =
            initialRevision && initialRevision.workflow_variant_id === selectedVariantId
                ? initialRevision.id
                : latestRevision?.id

        if (nextRevisionId) {
            setSelectedRevisionId(nextRevisionId)
        }
    }, [
        initialRevision,
        latestRevision?.id,
        selectedRevisionId,
        selectedVariantId,
        variantRevisions,
    ])

    const selectedVariant = useMemo(
        () => variants.find((variant) => variant.id === selectedVariantId),
        [selectedVariantId, variants],
    )

    const selectedRevision = useMemo(
        () => (variantRevisions || []).find((revision) => revision.id === selectedRevisionId),
        [selectedRevisionId, variantRevisions],
    )

    useEffect(() => {
        if (!selectedRevisionId) return
        const revision = revisionList.find((item) => item.id === selectedRevisionId)
        if (revision?.workflow_variant_id && revision.workflow_variant_id !== selectedVariantId) {
            setSelectedVariantId(revision.workflow_variant_id)
        }
    }, [revisionList, selectedRevisionId, selectedVariantId])

    const variantSlug =
        selectedVariant?.slug ||
        selectedVariant?.name ||
        selectedRevision?.name ||
        "my-variant-slug"
    const variantVersion = selectedRevision?.version ?? latestRevision?.version ?? 1
    const appSlug = currentApp?.slug || currentApp?.name || "my-app-slug"
    const apiKey = apiKeyValue || "YOUR_API_KEY"

    const invokeLlmUrl = (uri && uri.trim()) || ""

    // Build params for invoke LLM (with variant refs instead of environment)
    const params = useMemo(() => {
        const synthesized = variableNames.map((name) => ({name, input: name === "messages"}))

        const inputs: Record<string, any> = {}

        synthesized.forEach((item) => {
            inputs[item.name] = "add_a_value"
        })

        const hasMessagesParam = synthesized.some((p) => p?.name === "messages")
        const isChat = !!selectedRevision?.flags?.is_chat || hasMessagesParam
        if (isChat) {
            inputs["messages"] = [
                {
                    role: "user",
                    content: "",
                },
            ]
        }

        const params: Record<string, any> = {
            data: {inputs},
            references: {
                application: {slug: appSlug},
                application_variant: {slug: variantSlug},
                application_revision: {version: String(variantVersion)},
            },
        }

        return JSON.stringify(params, null, 2)
    }, [variableNames, selectedRevision?.flags?.is_chat, appSlug, variantSlug, variantVersion])

    const fetchConfigCodeSnippet = useMemo(
        () => ({
            python: buildPythonSnippet(appSlug, variantSlug, variantVersion),
            typescript: buildTypescriptSnippet(appSlug, variantSlug, variantVersion, apiKey),
            bash: buildCurlSnippet(appSlug, variantSlug, variantVersion, apiKey),
        }),
        [apiKey, appSlug, variantSlug, variantVersion],
    )

    const invokeLlmAppCodeSnippet = useMemo(
        () => ({
            python: invokeLlmApppythonCode(invokeLlmUrl, params, apiKeyValue || "x.xxxxxxxx"),
            bash: invokeLlmAppcURLCode(invokeLlmUrl, params, apiKeyValue || "x.xxxxxxxx"),
            typescript: invokeLlmApptsCode(invokeLlmUrl, params, apiKeyValue || "x.xxxxxxxx"),
        }),
        [apiKeyValue, invokeLlmUrl, params],
    )

    const renderTabChildren = useCallback(() => {
        return (
            <Spin spinning={isLoading}>
                <LanguageCodeBlock
                    fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                    invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                    selectedLang={selectedLang}
                    handleOpenSelectDeployVariantModal={() => {}}
                    invokeLlmUrl={invokeLlmUrl}
                    showDeployOverlay={false}
                />
            </Spin>
        )
    }, [fetchConfigCodeSnippet, invokeLlmAppCodeSnippet, invokeLlmUrl, isLoading, selectedLang])

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
            <div className="flex flex-col gap-6 p-4">
                <div className="flex flex-col">
                    <Typography.Text className="font-medium">Variant</Typography.Text>
                    <div className="flex items-center gap-2">
                        <SelectVariant
                            value={selectedRevisionId}
                            onChange={(value) => {
                                const nextRevisionId = value as string
                                setSelectedRevisionId(nextRevisionId)
                                const revision = revisionList.find(
                                    (item) => item.id === nextRevisionId,
                                )
                                if (revision?.workflow_variant_id) {
                                    setSelectedVariantId(revision.workflow_variant_id)
                                }
                            }}
                            showCreateNew={false}
                            showLatestTag={false}
                            className="w-[186px]"
                        />
                        <VariantDetailsWithStatus
                            revision={selectedRevision?.version ?? null}
                            variant={{
                                id: selectedRevision?.id || "",
                                deployedIn: [],
                                isLatestRevision:
                                    selectedRevision?.version === latestRevision?.version,
                            }}
                            hideName
                            showRevisionAsTag
                            showLatestTag={false}
                        />
                    </div>
                </div>

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

export default VariantUseApiContent
