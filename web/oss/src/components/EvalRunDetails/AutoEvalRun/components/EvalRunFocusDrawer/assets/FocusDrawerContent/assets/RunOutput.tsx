import {useMemo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"

const parseMaybeJson = (value: unknown): any => {
    if (typeof value !== "string") return value
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

const isPlainObject = (value: unknown): value is Record<string, any> => {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const KNOWN_OUTPUT_KEYS = [
    "outputs",
    "output",
    "response",
    "choices",
    "message",
    "content",
    "text",
    "value",
    "result",
    "payload",
    "data",
]

const IGNORED_KEYS = ["inputs", "input", "prompt", "request", "parameter"]

const extractString = (value: unknown, depth = 0): string | null => {
    if (value == null || depth > 10) return null

    const parsed = parseMaybeJson(value)

    if (typeof parsed === "string") {
        const trimmed = parsed.trim()
        return trimmed.length ? trimmed : null
    }

    if (Array.isArray(parsed)) {
        for (const item of parsed) {
            const candidate = extractString(item, depth + 1)
            if (candidate) return candidate
        }
        return null
    }

    if (!isPlainObject(parsed)) return null

    for (const key of KNOWN_OUTPUT_KEYS) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            const candidate = extractString(parsed[key], depth + 1)
            if (candidate) return candidate
        }
    }

    for (const [key, nested] of Object.entries(parsed)) {
        if (IGNORED_KEYS.some((ignored) => key.toLowerCase().includes(ignored))) continue
        const candidate = extractString(nested, depth + 1)
        if (candidate) return candidate
    }

    try {
        const serialised = JSON.stringify(parsed, null, 2)
        return serialised.trim().length ? serialised : null
    } catch {
        return null
    }
}

export const fallbackPrimitive = (value: unknown): string | null => {
    if (value == null) return null
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

export const resolveOnlineOutput = (sources: unknown[]): string | null => {
    for (const source of sources) {
        const candidate = extractString(source)
        if (candidate && candidate.trim().length > 0) return candidate
    }
    return null
}

const RunOutput = ({
    runId,
    scenarioId,
    stepKey,
    showComparisons,
}: {
    runId: string
    scenarioId?: string
    stepKey?: string
    showComparisons?: boolean
}) => {
    const evalType = useAtomValue(evalTypeAtom)
    const {
        value,
        rawValue,
        messageNodes: nodes,
        hasError: err,
        trace,
    } = useInvocationResult({
        scenarioId: scenarioId ?? "",
        stepKey: stepKey ?? "",
        editorType: "simple",
        viewType: evalType === "online" ? "table" : "single",
        runId,
    })

    const displayValue = useMemo(() => {
        if (nodes) return undefined

        if (evalType === "online") {
            const sources: unknown[] = [
                rawValue,
                value,
                trace?.data?.outputs,
                trace?.data,
                trace?.outputs,
                trace?.response,
                trace?.tree?.nodes,
                trace?.nodes,
            ]

            const extracted = resolveOnlineOutput(sources)
            const fallback = fallbackPrimitive(value) ?? "N/A"
            const result = extracted ?? fallback

            return result
        }

        return fallbackPrimitive(value) ?? "N/A"
    }, [evalType, nodes, rawValue, value, trace, runId, scenarioId, stepKey])

    return (
        <div
            className={clsx(
                showComparisons
                    ? "!w-[480px] shrink-0 px-3 border-0 border-r border-solid border-white"
                    : "w-full",
                "min-h-0",
            )}
        >
            {nodes ? (
                nodes
            ) : (
                <SimpleSharedEditor
                    key={`output-${scenarioId}-${runId}`}
                    handleChange={() => {}}
                    initialValue={displayValue}
                    syncWithInitialValueChanges
                    headerName="Output"
                    editorType="borderless"
                    state="readOnly"
                    disabled
                    readOnly
                    editorClassName="!text-xs"
                    error={err}
                    placeholder="N/A"
                    className="!w-[97.5%]"
                />
            )}
        </div>
    )
}

export default RunOutput
