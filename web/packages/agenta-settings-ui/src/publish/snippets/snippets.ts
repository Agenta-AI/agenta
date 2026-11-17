import {createT} from "@agenta/i18n"
import publishCatalog from "@agenta/i18n/catalogs/publish"

import agentCurlCode from "./curl"
import agentPythonCode from "./python"
import type {AgentInvokeSnippetInput} from "./request"
import agentTypescriptCode from "./typescript"

const t = createT(publishCatalog)

export type AgentSnippetLang = "python" | "typescript" | "bash"

const BUILDERS: Record<AgentSnippetLang, (input: AgentInvokeSnippetInput) => string> = {
    python: agentPythonCode,
    typescript: agentTypescriptCode,
    bash: agentCurlCode,
}

/** Both invoke snippets for one language, streaming first. */
export const buildAgentSnippets = (
    lang: AgentSnippetLang,
    input: Omit<AgentInvokeSnippetInput, "stream">,
) => [
    {
        key: "stream",
        title: t("publish.streamingResponse"),
        code: BUILDERS[lang]({...input, stream: true}),
    },
    {
        key: "json",
        title: t("publish.jsonResponse"),
        code: BUILDERS[lang]({...input, stream: false}),
    },
]
