import dynamic from "next/dynamic"

import SharedEditor from "../../../SharedEditor"

const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})

export default function ErrorPanel({result}: {result: any}) {
    let errorText =
        typeof result?.error === "string" ? result.error : String(result?.error ?? "Error")

    if (
        errorText === "An unknown error occurred" ||
        errorText === "Unknown error" ||
        errorText === "Error"
    ) {
        const detail =
            typeof result?.metadata?.rawError?.detail === "string"
                ? result.metadata.rawError.detail
                : undefined
        if (detail) {
            errorText = detail
        }
        const retryAfter = result?.metadata?.retryAfter
        if (retryAfter) {
            errorText = `${errorText} Retry after ${retryAfter}s.`
        }
    }
    return (
        <SharedEditor
            initialValue={errorText}
            editorType="borderless"
            state="filled"
            readOnly
            disabled
            error
            className="w-full"
            editorClassName="min-h-4 [&_p:first-child]:!mt-0"
            footer={<GenerationResultUtils className="mt-2" result={result} />}
            handleChange={() => undefined}
        />
    )
}
