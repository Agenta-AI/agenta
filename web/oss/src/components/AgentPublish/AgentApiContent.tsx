import {useMemo, useState} from "react"

import {getAgentaApiUrl} from "@agenta/shared/api"
import {CopyButton} from "@agenta/ui"
import {PythonOutlined} from "@ant-design/icons"
import {FileCode, FileTs} from "@phosphor-icons/react"
import {Tabs, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {
    AGENT_INVOKE_DOCS_URL,
    agentHostFromApiUrl,
} from "@/oss/code_snippets/endpoints/invoke_agent/request"
import {
    buildAgentSnippets,
    type AgentSnippetLang as SnippetLang,
} from "@/oss/code_snippets/endpoints/invoke_agent/snippets"
import CodeBlock from "@/oss/components/DynamicCodeBlock/CodeBlock"
import {projectIdAtom} from "@/oss/state/project"

const ApiKeyInput = dynamic(
    () => import("@/oss/components/pages/app-management/components/ApiKeyInput"),
    {ssr: false},
)

const SnippetBlock = ({title, code, lang}: {title: string; code: string; lang: SnippetLang}) => (
    <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
            <Typography.Text className="font-[500]">{title}</Typography.Text>
            <CopyButton buttonText={null} text={code} icon={true} />
        </div>
        <CodeBlock key={lang} language={lang} value={code} />
    </div>
)

/**
 * Publish > API: how to call this agent over HTTP. The layout is the classic "Use API"
 * drawer's (API key field, then Python / TypeScript / cURL tabs); the snippets follow the
 * "Invoke an agent" docs page and always target the agent's default variant at its latest
 * revision.
 */
const AgentApiContent = ({agentId}: {agentId: string}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const [selectedLang, setSelectedLang] = useState<SnippetLang>("python")
    const [apiKeyValue, setApiKeyValue] = useState("")
    const host = useMemo(() => agentHostFromApiUrl(getAgentaApiUrl()), [])
    const apiKey = apiKeyValue || "YOUR_API_KEY"

    const snippets = useMemo(
        () => buildAgentSnippets(selectedLang, {host, projectId, agentId, apiKey}),
        [selectedLang, host, projectId, agentId, apiKey],
    )

    const body = (
        <div className="flex flex-col gap-6">
            {snippets.map((snippet) => (
                <SnippetBlock
                    key={snippet.key}
                    title={snippet.title}
                    code={snippet.code}
                    lang={selectedLang}
                />
            ))}
        </div>
    )

    return (
        <div data-testid="agent-api-content">
            <div className="flex flex-col gap-3 p-4">
                <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />
                <Typography.Link href={AGENT_INVOKE_DOCS_URL} target="_blank" rel="noreferrer">
                    Invoke an agent
                </Typography.Link>
            </div>
            <Tabs
                destroyOnHidden
                activeKey={selectedLang}
                onChange={(key) => setSelectedLang(key as SnippetLang)}
                items={[
                    {key: "python", label: "Python", icon: <PythonOutlined />, children: body},
                    {
                        key: "typescript",
                        label: "TypeScript",
                        icon: <FileTs size={14} />,
                        children: body,
                    },
                    {key: "bash", label: "cURL", icon: <FileCode size={14} />, children: body},
                ]}
            />
        </div>
    )
}

export default AgentApiContent
