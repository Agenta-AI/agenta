import {useCallback, useEffect, useMemo, useState} from "react"

import {PythonOutlined} from "@ant-design/icons"
import {FileCode, FileTs} from "@phosphor-icons/react"
import {Select, Tabs, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import CopyButton from "@/oss/components/CopyButton/CopyButton"
import CodeBlock from "@/oss/components/DynamicCodeBlock/CodeBlock"
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

type CodeSnippets = {
    python: string
    typescript: string
    bash: string
}

const buildPythonSnippet = (appSlug: string, variantSlug: string, variantVersion: number) => {
    return `# Fetch configuration by variant
import agenta as ag

config = ag.ConfigManager.get_from_registry(
    app_slug="${appSlug}",
    variant_slug="${variantSlug}",
    variant_version=${variantVersion}  # Optional: If not provided, fetches the latest version
)

print("Fetched configuration:")
print(config)
`
}

const buildTypescriptSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
    apiKey: string,
) => {
    return `// Fetch configuration by variant
const fetchResponse = await fetch('https://cloud.agenta.ai/api/variants/configs/fetch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ${apiKey}'
  },
  body: JSON.stringify({
    variant_ref: {
      slug: '${variantSlug}',
      version: ${variantVersion},
      id: null
    },
    application_ref: {
      slug: '${appSlug}',
      version: null,
      id: null
    }
  })
});

const config = await fetchResponse.json();
console.log('Fetched configuration:');
console.log(config);
`
}

const buildCurlSnippet = (
    appSlug: string,
    variantSlug: string,
    variantVersion: number,
    apiKey: string,
) => {
    return `# Fetch configuration by variant
curl -X POST "https://cloud.agenta.ai/api/variants/configs/fetch" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "variant_ref": {
      "slug": "${variantSlug}",
      "version": ${variantVersion},
      "id": null
    },
    "application_ref": {
      "slug": "${appSlug}",
      "version": null,
      "id": null
    }
  }'
`
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

    const variantOptions = useMemo(
        () =>
            variants.map((variant) => ({
                value: variant.variantId,
                label: variant.variantName || variant.name || "Unnamed variant",
            })),
        [variants],
    )

    const revisionOptions = useMemo(() => {
        const sortedRevisions = (variantRevisions || [])
            .slice()
            .sort((a, b) => b.revision - a.revision)
        return sortedRevisions.map((revision) => ({
            value: revision.id,
            label: `Version ${revision.revision}`,
        }))
    }, [variantRevisions])

    const selectedVariant = useMemo(
        () => variants.find((variant) => variant.variantId === selectedVariantId),
        [selectedVariantId, variants],
    )

    const selectedRevision = useMemo(
        () => (variantRevisions || []).find((revision) => revision.id === selectedRevisionId),
        [selectedRevisionId, variantRevisions],
    )

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
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-2 flex-1">
                        <Typography.Text className="font-medium">Variant</Typography.Text>
                        <Select
                            showSearch
                            options={variantOptions}
                            placeholder="Select a variant"
                            value={selectedVariantId}
                            onChange={(value) => {
                                setSelectedVariantId(value)
                                setSelectedRevisionId(undefined)
                            }}
                            filterOption={(input, option) =>
                                (option?.label as string)
                                    .toLowerCase()
                                    .includes(input.toLowerCase())
                            }
                        />
                    </div>

                    <div className="flex flex-col gap-2 flex-1">
                        <Typography.Text className="font-medium">Version</Typography.Text>
                        <Select
                            showSearch
                            options={revisionOptions}
                            placeholder="Select a version"
                            value={selectedRevisionId}
                            onChange={(value) => setSelectedRevisionId(value)}
                            disabled={!selectedVariantId}
                            filterOption={(input, option) =>
                                (option?.label as string)
                                    .toLowerCase()
                                    .includes(input.toLowerCase())
                            }
                        />
                    </div>
                </div>

                <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />

                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <Typography.Text className="font-medium">Use API</Typography.Text>
                        <CopyButton text={activeSnippet} icon={true} buttonText={null} />
                    </div>
                    <CodeBlock language={selectedLang} value={activeSnippet} />
                </div>
            </div>
        )
    }, [
        apiKeyValue,
        codeSnippets,
        revisionOptions,
        selectedLang,
        selectedRevisionId,
        selectedVariantId,
        variantOptions,
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
                icon: <FileTs size={14} />,
                children: renderTabChildren(),
            },
            {
                key: "bash",
                label: "cURL",
                icon: <FileCode size={14} />,
                children: renderTabChildren(),
            },
        ],
        [renderTabChildren],
    )

    return (
        <Tabs
            items={tabItems}
            onChange={setSelectedLang}
            activeKey={selectedLang}
            destroyInactiveTabPane
        />
    )
}

export default VariantUseApiContent
