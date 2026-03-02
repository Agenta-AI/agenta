import {useCallback, useEffect, useMemo, useState} from "react"

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
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {useAppId} from "@/oss/hooks/useAppId"
import {currentAppAtom, useURI} from "@/oss/state/app"
import {stablePromptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {revisionsByVariantIdAtomFamily, variantsAtom} from "@/oss/state/variant/atoms/fetcher"
import {
    latestRevisionInfoByVariantIdAtomFamily,
    revisionListAtom,
} from "@/oss/state/variant/selectors/variant"

const ApiKeyInput = dynamic(
    () => import("@/oss/components/pages/app-management/components/ApiKeyInput"),
    {ssr: false},
)

interface VariantUseApiContentProps {
    initialRevisionId?: string
}

const VariantUseApiContent = ({initialRevisionId}: VariantUseApiContentProps) => {
    const appId = useAppId()
    const variants = useAtomValue(variantsAtom)
    const revisionList = useAtomValue(revisionListAtom)
    const currentApp = useAtomValue(currentAppAtom)

    const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>()
    const [selectedRevisionId, setSelectedRevisionId] = useState<string | undefined>()
    const [selectedLang, setSelectedLang] = useState("python")
    const [apiKeyValue, setApiKeyValue] = useState("")

    // Get URI for the selected variant
    const {data: uri, isLoading: isUriQueryLoading} = useURI(appId, selectedVariantId)
    const isLoading = Boolean(selectedVariantId) && isUriQueryLoading

    // Get variable names for the selected revision
    const variableNames = useAtomValue(
        stablePromptVariablesAtomFamily(selectedRevisionId || ""),
    ) as string[]

    const initialRevision = useMemo(
        () => revisionList.find((rev) => rev.id === initialRevisionId),
        [initialRevisionId, revisionList],
    )

    useEffect(() => {
        if (initialRevision?.variantId) {
            setSelectedVariantId(initialRevision.variantId)
            setSelectedRevisionId(initialRevision.id)
            return
        }

        if (!selectedVariantId && variants.length) {
            setSelectedVariantId(variants[0].variantId)
        }
    }, [initialRevision, selectedVariantId, variants])

    const variantRevisionsAtom = useMemo(
        () => revisionsByVariantIdAtomFamily(selectedVariantId || ""),
        [selectedVariantId],
    )
    const latestRevisionAtom = useMemo(
        () => latestRevisionInfoByVariantIdAtomFamily(selectedVariantId || ""),
        [selectedVariantId],
    )

    const variantRevisions = useAtomValue(variantRevisionsAtom)
    const latestRevision = useAtomValue(latestRevisionAtom)

    useEffect(() => {
        if (!selectedVariantId) return

        const hasSelectedRevision =
            selectedRevisionId &&
            (variantRevisions || []).some((rev) => rev.id === selectedRevisionId)

        if (hasSelectedRevision) return

        const nextRevisionId =
            initialRevision && initialRevision.variantId === selectedVariantId
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
        () => variants.find((variant) => variant.variantId === selectedVariantId),
        [selectedVariantId, variants],
    )

    const selectedRevision = useMemo(
        () => (variantRevisions || []).find((revision) => revision.id === selectedRevisionId),
        [selectedRevisionId, variantRevisions],
    )

    useEffect(() => {
        if (!selectedRevisionId) return
        const revision = revisionList.find((item) => item.id === selectedRevisionId)
        if (revision?.variantId && revision.variantId !== selectedVariantId) {
            setSelectedVariantId(revision.variantId)
        }
    }, [revisionList, selectedRevisionId, selectedVariantId])

    const variantSlug =
        (selectedVariant as any)?.variantSlug ||
        selectedVariant?.variantName ||
        (selectedRevision as any)?.variantName ||
        "my-variant-slug"
    const variantVersion = selectedRevision?.revision ?? latestRevision?.revision ?? 1
    const appSlug = (currentApp as any)?.app_slug || currentApp?.app_name || "my-app-slug"
    const apiKey = apiKeyValue || "YOUR_API_KEY"

    const invokeLlmUrl = uri ?? ""

    // Build params for invoke LLM (with variant refs instead of environment)
    const params = useMemo(() => {
        const synthesized = variableNames.map((name) => ({name, input: name === "messages"}))

        const mainParams: Record<string, any> = {}
        const secondaryParams: Record<string, any> = {}

        synthesized.forEach((item) => {
            if (item.input) {
                mainParams[item.name] = "add_a_value"
            } else {
                secondaryParams[item.name] = "add_a_value"
            }
        })

        const hasMessagesParam = synthesized.some((p) => p?.name === "messages")
        const isChat = currentApp?.app_type === "chat" || hasMessagesParam
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

        // Use variant refs instead of environment
        mainParams["app"] = appSlug
        mainParams["variant_slug"] = variantSlug
        mainParams["variant_version"] = variantVersion

        return JSON.stringify(mainParams, null, 2)
    }, [variableNames, currentApp?.app_type, appSlug, variantSlug, variantVersion])

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
                                if (revision?.variantId) {
                                    setSelectedVariantId(revision.variantId)
                                }
                            }}
                            showCreateNew={false}
                            showLatestTag={false}
                            className="w-[186px]"
                        />
                        <VariantDetailsWithStatus
                            revision={selectedRevision?.revision ?? null}
                            variant={{
                                id: selectedRevision?.id || "",
                                deployedIn: [],
                                isLatestRevision: selectedRevision?.isLatestRevision ?? false,
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
