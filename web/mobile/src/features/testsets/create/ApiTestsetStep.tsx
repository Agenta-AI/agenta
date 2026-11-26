import {useMemo, useState} from "react"

import {
    buildTestsetJsonSnippets,
    buildTestsetUploadSnippets,
    CodeBlock,
    TESTSET_CREATE_DOCS_URL,
    type AppEndpointLang,
} from "@agenta/settings-ui"
import {getAgentaApiUrl} from "@agenta/shared/api"
import {Button, DialogFooter, Segmented} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"

type SourceType = "csv" | "json"

const SOURCE_TYPES: {value: SourceType; label: string}[] = [
    {value: "csv", label: "CSV"},
    {value: "json", label: "JSON"},
]

const LANGS: {value: AppEndpointLang; label: string}[] = [
    {value: "python", label: "Python"},
    {value: "typescript", label: "TypeScript"},
    {value: "bash", label: "cURL"},
]

const SNIPPET_FILE: Record<AppEndpointLang, string> = {
    python: "request.py",
    typescript: "request.ts",
    bash: "request.sh",
}

/** The API step of the create dialog: example requests that create a test set. */
export const ApiTestsetStep = ({onClose}: {onClose: () => void}) => {
    const [source, setSource] = useState<SourceType>("csv")
    const [lang, setLang] = useState<AppEndpointLang>("python")
    const code = useMemo(() => {
        const input = {apiUrl: getAgentaApiUrl()}
        const snippets =
            source === "csv" ? buildTestsetUploadSnippets(input) : buildTestsetJsonSnippets(input)
        return snippets[lang]
    }, [source, lang])

    return (
        <>
            <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Select type</span>
                    <Segmented
                        size="sm"
                        options={SOURCE_TYPES}
                        value={source}
                        onChange={(value) => setSource(value as SourceType)}
                    />
                </div>
                <p className="m-0 text-sm text-muted-foreground">
                    Use these endpoints to create a test set via JSON or upload a file
                </p>
                <Segmented
                    size="sm"
                    options={LANGS}
                    value={lang}
                    onChange={(value) => setLang(value as AppEndpointLang)}
                />
                <CodeBlock
                    label={SNIPPET_FILE[lang]}
                    code={code}
                    maxHeightClass="max-h-[320px]"
                    data-testid="testset-api-snippet"
                />
            </div>
            <DialogFooter className="sm:justify-between">
                <a
                    href={TESTSET_CREATE_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-2 hover:underline"
                >
                    Read the docs
                    <ArrowSquareOut aria-hidden size={14} />
                </a>
                <Button variant="outline" onClick={onClose}>
                    Close
                </Button>
            </DialogFooter>
        </>
    )
}
