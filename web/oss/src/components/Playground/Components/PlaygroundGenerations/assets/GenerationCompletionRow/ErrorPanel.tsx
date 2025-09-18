import dynamic from "next/dynamic"

import SharedEditor from "../../../SharedEditor"

const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {ssr: false})

export default function ErrorPanel({result}: {result: any}) {
    const errorText =
        typeof result?.error === "string" ? result.error : String(result?.error ?? "Error")
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
