import {useState} from "react"

import {CodeBlock, type AppEndpointLang, type AppEndpointSnippets} from "@agenta/settings-ui"
import {message} from "@agenta/ui/app-message"
import {Segmented} from "@agenta/ui/ui"

const LANGS: {value: AppEndpointLang; label: string}[] = [
    {value: "python", label: "Python"},
    {value: "bash", label: "cURL"},
    {value: "typescript", label: "TypeScript"},
]

const FILE: Record<AppEndpointLang, string> = {
    python: "request.py",
    bash: "request.sh",
    typescript: "request.ts",
}

/** One snippet in the language the reader picks, with its copy button. */
export const EndpointSnippetSection = ({
    snippets,
    testId,
}: {
    snippets: AppEndpointSnippets
    testId: string
}) => {
    const [lang, setLang] = useState<AppEndpointLang>("python")
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <Segmented
                size="sm"
                options={LANGS}
                value={lang}
                onChange={(value) => setLang(value as AppEndpointLang)}
            />
            <CodeBlock
                label={FILE[lang]}
                code={snippets[lang]}
                maxHeightClass="max-h-[420px]"
                onCopyError={() => message.error("Couldn't copy the snippet")}
                data-testid={testId}
            />
        </div>
    )
}
