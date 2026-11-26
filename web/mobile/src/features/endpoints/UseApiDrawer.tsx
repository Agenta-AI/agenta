import {useState} from "react"

import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import type {AppEndpointLang, AppEndpointSnippets} from "@agenta/settings-ui"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    Segmented,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"
import {Copy} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import type {AppRevisionRow} from "../variants/useAppRevisions"

import {ApiKeyField} from "./ApiKeyField"
import {useAppSnippets, type SnippetTarget} from "./useEndpointSnippets"

const SnippetCodeView = dynamic(
    () => import("./SnippetCodeView").then((module) => module.SnippetCodeView),
    {ssr: false},
)

const LANGS: {value: AppEndpointLang; label: string}[] = [
    {value: "python", label: "Python"},
    {value: "typescript", label: "TypeScript"},
    {value: "bash", label: "cURL"},
]

const SHEET_FRAME = {
    side: "responsive",
    style: {"--ag-sheet-responsive-width": "720px"} as React.CSSProperties,
    className: "overflow-hidden max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none",
} as const

const Snippet = ({
    id,
    title,
    snippets,
    lang,
}: {
    id: string
    title: string
    snippets: AppEndpointSnippets
    lang: AppEndpointLang
}) => {
    const code = snippets[lang]
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code)
            message.success("Copied")
        } catch {
            message.error("Couldn't copy the snippet")
        }
    }
    return (
        <section className="flex min-w-0 flex-col gap-2" data-testid={`${id}-code`}>
            <div className="flex items-center justify-between">
                <h3 className="m-0 text-sm font-medium text-foreground">{title}</h3>
                <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Copy ${title}`}
                    onClick={() => void copy()}
                >
                    <Copy aria-hidden />
                </Button>
            </div>
            {/* The editor has no shell grammar: cURL stays plain text. Full height, no inner
                scroll, so the whole snippet shows. */}
            {lang === "bash" ? (
                <pre className="m-0 overflow-x-auto rounded-lg border border-solid border-border bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
                    {code}
                </pre>
            ) : (
                <SnippetCodeView id={`${id}-${lang}`} code={code} language={lang} />
            )}
        </section>
    )
}

/** The choices of the Variant picker: each variant's latest revision, as the old app lists them. */
export interface UseApiVariantChoice {
    rows: readonly AppRevisionRow[]
    initialRevisionId: string | null
}

/**
 * "How to use API": the code to fetch the config and to call the app, for one variant version
 * (Registry) or one environment (Deployments), with the reader's API key in it.
 */
export const UseApiDrawer = ({
    workspaceId,
    projectId,
    appSlug,
    variants,
    environment,
    onClose,
}: {
    workspaceId: string
    projectId: string
    appSlug: string | null
    /** Registry: pick a variant version. */
    variants?: UseApiVariantChoice
    /** Deployments: the selected environment and the revision deployed there. */
    environment?: {slug: string; revisionId: string | null}
    onClose: () => void
}) => {
    const [apiKey, setApiKey] = useState("")
    const [lang, setLang] = useState<AppEndpointLang>("python")
    const [revisionId, setRevisionId] = useState(
        variants?.initialRevisionId ?? variants?.rows[0]?.revisionId ?? "",
    )
    const chosen = variants?.rows.find((row) => row.revisionId === revisionId) ?? null
    const target: SnippetTarget =
        variants && chosen
            ? {variant: {slug: chosen.variantSlug ?? chosen.variantName, version: chosen.version}}
            : {environmentSlug: environment?.slug ?? "none"}
    const snippets = useAppSnippets({
        appSlug,
        revisionId: variants ? revisionId : (environment?.revisionId ?? ""),
        target,
        apiKey: apiKey.trim(),
    })

    return (
        <Sheet open onOpenChange={(next) => !next && onClose()}>
            <SheetContent {...SHEET_FRAME}>
                <SheetHeader>
                    <SheetTitle>How to use API</SheetTitle>
                    <SheetDescription className="sr-only">
                        Code to fetch the configuration and to call the app.
                    </SheetDescription>
                </SheetHeader>
                <div className="ag-scroll-quiet flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
                    {variants ? (
                        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                            Variant
                            <Select value={revisionId} onValueChange={setRevisionId}>
                                <SelectTrigger className="w-[260px]" aria-label="Variant">
                                    <SelectValue placeholder="Pick a variant" />
                                </SelectTrigger>
                                <SelectContent>
                                    {variants.rows.map((row) => (
                                        <SelectItem key={row.revisionId} value={row.revisionId}>
                                            <VariantDetailsWithStatus
                                                variant={{id: row.revisionId}}
                                                variantName={row.variantName}
                                                revision={row.version}
                                                showRevisionAsTag
                                                hideDiscard
                                            />
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </label>
                    ) : null}
                    <ApiKeyField
                        workspaceId={workspaceId}
                        projectId={projectId}
                        value={apiKey}
                        onChange={setApiKey}
                    />
                    <Segmented
                        aria-label="Language"
                        options={LANGS}
                        value={lang}
                        onChange={(value) => setLang(value as AppEndpointLang)}
                    />
                    {snippets.isError ? (
                        <p className="m-0 text-sm text-destructive">Couldn't load this revision.</p>
                    ) : (
                        <>
                            <Snippet
                                id="use-api-config"
                                title="Fetch Prompt/Config"
                                snippets={snippets.fetchConfig}
                                lang={lang}
                            />
                            <Snippet
                                id="use-api-invoke"
                                title="Invoke LLM"
                                snippets={snippets.invoke}
                                lang={lang}
                            />
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}
