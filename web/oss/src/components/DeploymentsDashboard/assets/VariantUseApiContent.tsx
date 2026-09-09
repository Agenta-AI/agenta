import {useCallback, useEffect, useMemo, useState} from "react"

import {
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
    workflowRevisionsListDataAtomFamily,
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
    const currentApp = useAtomValue(currentAppAtom)

    // The revision is the ONLY selection state here; the variant is DERIVED from it and is
    // never stored. Two states that must agree cannot be reconciled by effects that each
    // write what another reads: with more than one variant that reconciliation had no fixed
    // point and the drawer re-rendered forever (issue #6708).
    const [selectedRevisionId, setSelectedRevisionId] = useState<string | undefined>(
        initialRevisionId,
    )
    const [selectedLang, setSelectedLang] = useState("python")
    const [apiKeyValue, setApiKeyValue] = useState("")

    // The drawer is destroyed when it closes, so this only fires when the host swaps the
    // opened row while the drawer stays mounted. It is keyed on the prop, not on derived
    // state, so it writes once per prop value.
    useEffect(() => {
        if (initialRevisionId) setSelectedRevisionId(initialRevisionId)
    }, [initialRevisionId])

    // Get invocation URL and input ports from workflow molecule
    const uri = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.deploymentUrl(selectedRevisionId || ""),
            [selectedRevisionId],
        ),
    )

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
    const isChat = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.isChat(selectedRevisionId || ""),
            [selectedRevisionId],
        ),
    )

    // The selected revision carries its own parent variant, so read it straight from the
    // revision entity instead of looking it up in a list that arrives later.
    const selectedRevision = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.data(selectedRevisionId || ""),
            [selectedRevisionId],
        ),
    )

    const derivedVariantId =
        selectedRevision?.workflow_variant_id ?? selectedRevision?.variant_id ?? undefined

    // With no revision selected yet the drawer defaults to the first variant, and the effect
    // below then adopts that variant's latest revision.
    const selectedVariantId = derivedVariantId ?? (selectedRevisionId ? undefined : variants[0]?.id)

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

    // The only other writer of the selection. It runs while nothing is selected and writes a
    // truthy id, so it can run at most once and cannot cycle with anything.
    useEffect(() => {
        if (selectedRevisionId) return
        if (latestRevision?.id) setSelectedRevisionId(latestRevision.id)
    }, [latestRevision?.id, selectedRevisionId])

    const selectedVariant = useMemo(
        () => variants.find((variant) => variant.id === selectedVariantId),
        [selectedVariantId, variants],
    )

    // Show the spinner while the opened revision resolves, rather than a snippet built from
    // whichever variant happens to be first.
    const isLoading = Boolean(selectedRevisionId) && !selectedRevision

    // The variants list can arrive after the revision does; the revision carries the same slug.
    const variantSlug =
        selectedVariant?.slug || selectedRevision?.workflow_variant_slug || "my-variant-slug"
    const variantVersion = selectedRevision?.version ?? latestRevision?.version ?? 1
    const appSlug = currentApp?.slug || "my-app-slug"
    const apiKey = apiKeyValue || "YOUR_API_KEY"

    const invokeLlmUrl = (uri && uri.trim()) || ""

    // Build params for invoke LLM (with variant refs instead of environment)
    const params = useMemo(() => {
        const inputs: Record<string, any> = {}

        variableNames.forEach((name) => {
            inputs[name] = "add_a_value"
        })

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
    }, [variableNames, isChat, appSlug, variantSlug, variantVersion])

    const fetchConfigCodeSnippet = useMemo(
        () => ({
            python: buildPythonSnippet(appSlug, variantSlug, variantVersion, apiKey),
            typescript: buildTypescriptSnippet(appSlug, variantSlug, variantVersion, apiKey),
            bash: buildCurlSnippet(appSlug, variantSlug, variantVersion, apiKey),
        }),
        [apiKey, appSlug, variantSlug, variantVersion],
    )

    const invokeLlmAppCodeSnippet = useMemo(
        () => ({
            python: invokeLlmApppythonCode(invokeLlmUrl, params, apiKey),
            bash: invokeLlmAppcURLCode(invokeLlmUrl, params, apiKey),
            typescript: invokeLlmApptsCode(invokeLlmUrl, params, apiKey),
        }),
        [apiKey, invokeLlmUrl, params],
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
                                setSelectedRevisionId(value as string)
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
