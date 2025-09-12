import {useMemo} from "react"

import clsx from "clsx"
import {atom, useAtomValue} from "jotai"
import JSON5 from "json5"
import dynamic from "next/dynamic"

import ToolCallView from "@/oss/components/Playground/Components/ToolCallView"
import {generationResultAtomFamily} from "@/oss/components/Playground/state/atoms"
import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
// Do not derive revision from rowIdIndex in comparison; use the column's variantId
import {rowResponsesForDisplayAtomFamily} from "@/oss/state/generation/selectors"

import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import SharedEditor from "../../SharedEditor"

import {GenerationComparisonCompletionOutputProps} from "./types"
const GenerationResultUtils = dynamic(
    () => import("../../PlaygroundGenerations/assets/GenerationResultUtils"),
    {ssr: false},
)

const handleChange = () => undefined

const GenerationComparisonCompletionOutput = ({
    rowId,
    focusDisable = false,
    variantId,
    variantIndex,
    isLastRow,
    registerToWebWorker,
}: GenerationComparisonCompletionOutputProps) => {
    // Helper: strip Markdown code fences like ```json\n...\n```
    const stripCodeFences = (input: string): string => {
        if (typeof input !== "string") return input as any
        const trimmed = input.trim()
        if (!trimmed.startsWith("```")) return trimmed
        // Remove first fence line and optional language
        const lines = trimmed.split(/\r?\n/)
        if (lines[0].startsWith("```")) {
            // Drop opening fence line
            lines.shift()
        }
        // If last line is a closing fence, drop it
        if (lines.length && lines[lines.length - 1].trim().startsWith("```")) {
            lines.pop()
        }
        return lines.join("\n").trim()
    }

    // Helper: safely parse possibly-JSON content (supports JSON in code fences)
    const safeJsonishParse = (input: string): {ok: true; value: any} | {ok: false} => {
        if (typeof input !== "string") return {ok: false}
        const stripped = stripCodeFences(input)
        try {
            const parsed = JSON5.parse(stripped)
            return {ok: true, value: parsed}
        } catch {
            return {ok: false}
        }
    }
    // Use the column's variantId as the revisionId in comparison mode
    const revisionId = variantId || ""
    // Memoize atomFamily instance to avoid creating a new atom per render which can cause update loops
    const responsesAtom = useMemo(
        () => (revisionId ? rowResponsesForDisplayAtomFamily({rowId, revisionId}) : null),
        [rowId, revisionId],
    )
    // Stable empty atom fallback when revisionId is not yet available
    const emptyArrayAtom = useMemo(() => atom<any[]>([]), [])
    const normalizedResponses = useAtomValue(responsesAtom || emptyArrayAtom)

    const {resultHash, isRunning} = useAtomValue(
        useMemo(() => generationResultAtomFamily({variantId, rowId}), [variantId, rowId]),
    )

    const result = useMemo(() => {
        return getResponseLazy(resultHash)
    }, [resultHash])

    // Normalize response content similar to single view
    const raw = result?.response?.data
    const contentCandidate =
        typeof raw === "string"
            ? raw
            : raw && typeof raw === "object"
              ? ((raw as any).content ?? (raw as any).data ?? raw)
              : ""

    let isJSON = false
    let displayValue: any = contentCandidate
    if (typeof contentCandidate === "string") {
        const res = safeJsonishParse(contentCandidate)
        if (res.ok) {
            isJSON = true
            displayValue = JSON.stringify(res.value, null, 2)
        } else {
            isJSON = false
        }
    } else if (contentCandidate && typeof contentCandidate === "object") {
        isJSON = true
        try {
            displayValue = JSON.stringify(contentCandidate, null, 2)
        } catch {
            // fallback to string coercion
            displayValue = String(contentCandidate)
        }
    }

    // Prefer normalized responses when present; resolve hashes to full responses
    const hasNormalized = Array.isArray(normalizedResponses) && normalizedResponses.length > 0
    const {normalizedText, lastResult} = useMemo(() => {
        if (!hasNormalized) return {normalizedText: "", lastResult: null}
        const parts: string[] = []
        let last: any = null
        for (const n of normalizedResponses as any[]) {
            const v = n?.content?.value
            if (!v) continue
            const res = getResponseLazy(v)
            if (res) {
                last = res
                const data = (res as any)?.response?.data
                if (Array.isArray(data)) {
                    // Join array of messages/content
                    const arr = data.map((m: any) => m?.content ?? "").filter(Boolean)
                    if (arr.length) parts.push(arr.join("\n\n"))
                } else if (data && typeof data === "object" && "content" in data) {
                    parts.push((data as any).content ?? "")
                } else if (typeof data === "string") {
                    parts.push(data)
                } else if ((res as any)?.error) {
                    parts.push(String((res as any).error))
                } else if (data !== undefined) {
                    parts.push(JSON.stringify(data))
                }
            } else if (typeof v === "string") {
                // Fallback to raw value if cache miss
                parts.push(v)
            }
        }
        return {normalizedText: parts.filter(Boolean).join("\n\n"), lastResult: last}
    }, [hasNormalized, normalizedResponses])

    return (
        <>
            {variantIndex === 0 ? (
                <div
                    className={clsx([
                        "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[3] !w-[400px]",
                        {"border-r": variantIndex === 0},
                        "shrink-0",
                    ])}
                >
                    {variantIndex === 0 && (
                        <div className="w-full flex-1 shrink-0 sticky top-9 z-[2] border-0">
                            <GenerationCompletion rowId={rowId} withControls={isLastRow} />
                        </div>
                    )}
                </div>
            ) : null}

            <div
                className={clsx([
                    "!min-w-[400px] flex-1",
                    "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                ])}
            >
                <div className="flex h-full">
                    <div className="w-full flex-1 h-full">
                        <div
                            className={clsx([
                                "w-full sticky top-9 z-[2]",
                                {"py-3 px-4": isRunning || !result},
                            ])}
                        >
                            {isRunning ? (
                                <GenerationOutputText text="Running..." />
                            ) : hasNormalized ? (
                                (() => {
                                    // Prefer rendering tool/function calls if last normalized result contains them
                                    const lastRaw = (lastResult as any)?.response?.data
                                    if (typeof lastRaw === "string") {
                                        const t = lastRaw.trim()
                                        if (t.startsWith("[") || t.startsWith("{")) {
                                            const parsedRes = safeJsonishParse(lastRaw)
                                            if (parsedRes.ok && Array.isArray(parsedRes.value)) {
                                                return (
                                                    <ToolCallView
                                                        resultData={parsedRes.value}
                                                        className="w-full !px-4"
                                                        footer={
                                                            lastResult ? (
                                                                <GenerationResultUtils
                                                                    className="mt-2"
                                                                    result={lastResult}
                                                                />
                                                            ) : undefined
                                                        }
                                                    />
                                                )
                                            }
                                        }
                                    } else if (Array.isArray(lastRaw)) {
                                        return (
                                            <ToolCallView
                                                resultData={lastRaw}
                                                className="w-full !px-4"
                                                footer={
                                                    lastResult ? (
                                                        <GenerationResultUtils
                                                            className="mt-2"
                                                            result={lastResult}
                                                        />
                                                    ) : undefined
                                                }
                                            />
                                        )
                                    }

                                    // Otherwise, if normalizedText itself is a stringified array of tool/function calls, render ToolCallView
                                    if (typeof normalizedText === "string") {
                                        const nt = normalizedText.trim()
                                        if (nt.startsWith("[") || nt.startsWith("{")) {
                                            const parsedNormRes = safeJsonishParse(normalizedText)
                                            if (
                                                parsedNormRes.ok &&
                                                Array.isArray(parsedNormRes.value)
                                            ) {
                                                return (
                                                    <ToolCallView
                                                        resultData={parsedNormRes.value}
                                                        className="w-full !px-4"
                                                        footer={
                                                            lastResult ? (
                                                                <GenerationResultUtils
                                                                    className="mt-2"
                                                                    result={lastResult}
                                                                />
                                                            ) : undefined
                                                        }
                                                    />
                                                )
                                            }
                                        }
                                    }

                                    // Otherwise, pretty print normalized text when it is JSON
                                    let normIsJSON = false
                                    let normDisplay = normalizedText as any
                                    if (typeof normalizedText === "string") {
                                        const res = safeJsonishParse(normalizedText)
                                        if (res.ok) {
                                            normIsJSON = true
                                            normDisplay = JSON.stringify(res.value, null, 2)
                                        } else {
                                            normIsJSON = false
                                            normDisplay = normalizedText
                                        }
                                    }

                                    return (
                                        <SharedEditor
                                            initialValue={normDisplay}
                                            handleChange={handleChange}
                                            editorType="borderless"
                                            state="filled"
                                            readOnly
                                            disabled
                                            editorProps={{codeOnly: normIsJSON}}
                                            className="!rounded-none !px-4"
                                            editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                            footer={
                                                lastResult ? (
                                                    <GenerationResultUtils
                                                        className="mt-2"
                                                        result={lastResult}
                                                    />
                                                ) : undefined
                                            }
                                        />
                                    )
                                })()
                            ) : !result ? (
                                <GenerationOutputText text="Click run to generate" isPlaceholder />
                            ) : result.error ? (
                                // <SharedEditor
                                //     initialValue={result?.error}
                                //     editorType="borderless"
                                //     handleChange={handleChange}
                                //     state="filled"
                                //     readOnly
                                //     disabled
                                //     className={clsx(["!pt-0", "!rounded-none"])}
                                //     error={!!result.error}
                                //     editorClassName="min-h-4 [&_p:first-child]:!mt-0 py-3"
                                //     footer={
                                //         <GenerationResultUtils className="mt-2" result={result} />
                                //     }
                                // />
                                2
                            ) : result.response ? (
                                (() => {
                                    const rawData = (result as any)?.response?.data
                                    // Prefer contentCandidate if it's a stringified array
                                    if (typeof contentCandidate === "string") {
                                        const t = contentCandidate.trim()
                                        if (t.startsWith("[") || t.startsWith("{")) {
                                            const parsedRes = safeJsonishParse(contentCandidate)
                                            if (parsedRes.ok && Array.isArray(parsedRes.value)) {
                                                return 3
                                                // <ToolCallView
                                                //     resultData={parsedRes.value}
                                                //     className="w-full !px-4"
                                                //     footer={
                                                //         <GenerationResultUtils
                                                //             className="mt-2"
                                                //             result={result}
                                                //         />
                                                //     }
                                                // />
                                            }
                                        }
                                    }
                                    // If contentCandidate is already an array
                                    if (Array.isArray(contentCandidate)) {
                                        return 4
                                        // <ToolCallView
                                        //     resultData={contentCandidate}
                                        //     className="w-full !px-4"
                                        //     footer={
                                        //         <GenerationResultUtils
                                        //             className="mt-2"
                                        //             result={result}
                                        //         />
                                        //     }
                                        // />
                                    }
                                    // If raw response data is stringified array
                                    if (typeof rawData === "string") {
                                        const tr = rawData.trim()
                                        if (tr.startsWith("[") || tr.startsWith("{")) {
                                            const parsedRes = safeJsonishParse(rawData)
                                            if (parsedRes.ok && Array.isArray(parsedRes.value)) {
                                                return 5
                                                // <ToolCallView
                                                //     resultData={parsedRes.value}
                                                //     className="w-full !px-4"
                                                //     footer={
                                                //         <GenerationResultUtils
                                                //             className="mt-2"
                                                //             result={result}
                                                //         />
                                                //     }
                                                // />
                                            }
                                        }
                                    }
                                    // If raw response data is array
                                    if (Array.isArray(rawData)) {
                                        return 6
                                        // <ToolCallView
                                        //     resultData={rawData}
                                        //     className="w-full !px-4"
                                        //     footer={
                                        //         <GenerationResultUtils
                                        //             className="mt-2"
                                        //             result={result}
                                        //         />
                                        //     }
                                        // />
                                    }
                                    // Fallback to editor
                                    return 7
                                    // <SharedEditor
                                    //     initialValue={displayValue}
                                    //     handleChange={handleChange}
                                    //     editorType="borderless"
                                    //     state="filled"
                                    //     readOnly
                                    //     editorProps={{
                                    //         codeOnly: isJSON,
                                    //     }}
                                    //     disabled
                                    //     className="!rounded-none !px-4"
                                    //     editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                    //     footer={
                                    //         <GenerationResultUtils
                                    //             className="mt-2"
                                    //             result={result}
                                    //         />
                                    //     }
                                    // />
                                })()
                            ) : (
                                8
                                // <SharedEditor
                                //     initialValue={displayValue}
                                //     handleChange={handleChange}
                                //     editorType="borderless"
                                //     state="filled"
                                //     readOnly
                                //     editorProps={{
                                //         codeOnly: isJSON,
                                //     }}
                                //     disabled
                                //     className="!rounded-none !px-4"
                                //     editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                //     footer={
                                //         <GenerationResultUtils className="mt-2" result={result} />
                                //     }
                                // />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

export default GenerationComparisonCompletionOutput
