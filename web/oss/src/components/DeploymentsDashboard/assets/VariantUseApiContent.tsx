import {useCallback, useEffect, useMemo, useState} from "react"

import {
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
    workflowRevisionRefsByVariantAtomFamily,
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

    // The revision is the authoritative selection; the parent variant is derived from it and
    // is never stored. Two states that must agree used to be reconciled by three effects that
    // each wrote what another read, and with more than one variant they oscillated instead of
    // settling on a coherent pair (issue #6708).
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
    const selectedRevisionQuery = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.query(selectedRevisionId || ""),
            [selectedRevisionId],
        ),
    )

    // Tell "still fetching" apart from "this revision does not exist". Without the split a
    // stale id (a deleted revision behind a shared link) would spin for ever.
    const isResolvingRevision =
        Boolean(selectedRevisionId) &&
        !selectedRevision &&
        Boolean(selectedRevisionQuery?.isPending)
    const isUnresolvableRevision =
        Boolean(selectedRevisionId) && !selectedRevision && !selectedRevisionQuery?.isPending

    const derivedVariantId =
        selectedRevision?.workflow_variant_id ?? selectedRevision?.variant_id ?? undefined

    // Before a revision is chosen, and when the chosen one cannot be resolved, the drawer
    // falls back to the first variant and the effect below adopts its latest revision.
    const needsFallbackVariant = !selectedRevisionId || isUnresolvableRevision
    const selectedVariantId =
        derivedVariantId ?? (needsFallbackVariant ? variants[0]?.id : undefined)

    // Only the newest revision's id and version are needed, so read the thin refs rather than
    // resolving every revision entity of the variant.
    const variantRevisionRefs = useAtomValue(
        useMemo(
            () => workflowRevisionRefsByVariantAtomFamily(selectedVariantId || ""),
            [selectedVariantId],
        ),
    )
    const latestRevision = useMemo(() => {
        if (!Array.isArray(variantRevisionRefs) || variantRevisionRefs.length === 0) return null
        // Already sorted by version desc from the atom family
        return variantRevisionRefs[0]
    }, [variantRevisionRefs])

    // The only other writer of the selection. It writes only while there is nothing usable
    // selected, and the functional update keeps a revision the prop supplied in the same pass.
    useEffect(() => {
        if (!latestRevision?.id) return
        if (selectedRevisionId && !isUnresolvableRevision) return
        setSelectedRevisionId((current) =>
            current && !isUnresolvableRevision ? current : latestRevision.id,
        )
    }, [isUnresolvableRevision, latestRevision?.id, selectedRevisionId])

    const selectedVariant = useMemo(
        () => variants.find((variant) => variant.id === selectedVariantId),
        [selectedVariantId, variants],
    )

    // Show the spinner while the opened revision is still being fetched, rather than a snippet
    // built from whichever variant happens to be first.
    const isLoading = isResolvingRevision

    // The variants list can arrive after the revision does; the revision carries the same slug.
    const variantSlug =
        selectedVariant?.slug ||
        selectedRevision?.workflow_variant_slug ||
        selectedRevision?.variant_slug ||
        "my-variant-slug"
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
