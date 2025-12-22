import {useCallback, useEffect, useMemo, useState} from "react"

import {PythonOutlined} from "@ant-design/icons"
import {FileCodeIcon, FileTsIcon} from "@phosphor-icons/react"
import {Tabs, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {buildCurlSnippet} from "@/oss/code_snippets/endpoints/fetch_variant/curl"
import {buildPythonSnippet} from "@/oss/code_snippets/endpoints/fetch_variant/python"
import {buildTypescriptSnippet} from "@/oss/code_snippets/endpoints/fetch_variant/typescript"
import CopyButton from "@/oss/components/CopyButton/CopyButton"
import CodeBlock from "@/oss/components/DynamicCodeBlock/CodeBlock"
import SelectVariant from "@/oss/components/Playground/Components/Menus/SelectVariant"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {currentAppAtom} from "@/oss/state/app"
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

interface CodeSnippets {
    python: string
    typescript: string
    bash: string
}

const VariantUseApiContent = ({initialRevisionId}: VariantUseApiContentProps) => {
    const variants = useAtomValue(variantsAtom)
    const revisionList = useAtomValue(revisionListAtom)
    const currentApp = useAtomValue(currentAppAtom)

    const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>()
    const [selectedRevisionId, setSelectedRevisionId] = useState<string | undefined>()
    const [selectedLang, setSelectedLang] = useState("python")
    const [apiKeyValue, setApiKeyValue] = useState("")

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
        selectedRevision?.variantName ||
        "my-variant-slug"
    const variantVersion = selectedRevision?.revision ?? latestRevision?.revision ?? 1
    const appSlug = (currentApp as any)?.app_slug || currentApp?.app_name || "my-app-slug"
    const apiKey = apiKeyValue || "YOUR_API_KEY"

    const codeSnippets: CodeSnippets = useMemo(
        () => ({
            python: buildPythonSnippet(appSlug, variantSlug, variantVersion),
            typescript: buildTypescriptSnippet(appSlug, variantSlug, variantVersion, apiKey),
            bash: buildCurlSnippet(appSlug, variantSlug, variantVersion, apiKey),
        }),
        [apiKey, appSlug, variantSlug, variantVersion],
    )

    const renderTabChildren = useCallback(() => {
        const activeSnippet = codeSnippets[selectedLang as keyof CodeSnippets]

        return (
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <Typography.Text className="font-medium">Use API</Typography.Text>
                    <CopyButton text={activeSnippet} icon={true} buttonText={null} />
                </div>
                <CodeBlock language={selectedLang} value={activeSnippet} />
            </div>
        )
    }, [
        apiKeyValue,
        codeSnippets,
        revisionList,
        selectedLang,
        selectedRevision?.id,
        selectedRevision?.isLatestRevision,
        selectedRevision?.revision,
        selectedRevisionId,
    ])

    const tabItems = useMemo(
        () => [
            {
                key: "python",
                label: "Python",
                icon: <PythonOutlined />,
                children: renderTabChildren(),
            },
            {
                key: "typescript",
                label: "TypeScript",
                icon: <FileTsIcon size={14} />,
                children: renderTabChildren(),
            },
            {
                key: "bash",
                label: "cURL",
                icon: <FileCodeIcon size={14} />,
                children: renderTabChildren(),
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
                items={tabItems}
                onChange={setSelectedLang}
                activeKey={selectedLang}
                destroyInactiveTabPane
            />
        </div>
    )
}

export default VariantUseApiContent
