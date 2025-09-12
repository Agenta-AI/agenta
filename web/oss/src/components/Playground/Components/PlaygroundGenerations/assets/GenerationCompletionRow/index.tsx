import {useCallback, useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"
import JSON5 from "json5"
import dynamic from "next/dynamic"

import RunButton from "@/oss/components/Playground/assets/RunButton"
import {autoScrollToBottom} from "@/oss/components/Playground/assets/utilities/utilityFunctions"
import ToolCallView from "@/oss/components/Playground/Components/ToolCallView"
import {schemaInputKeysAtom} from "@/oss/components/Playground/state/atoms/variants"
import {variablesByRevisionSelectorFamily} from "@/oss/components/Playground/state/selectors/variables"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {rowVariablesForDisplayAtomFamily} from "@/oss/state/generation/selectors"
import {promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

import {usePlaygroundLayout} from "../../../../hooks/usePlaygroundLayout"
import {
    generationResultAtomFamily,
    appChatModeAtom,
    displayedVariantsVariablesAtom,
    triggerWebWorkerTestAtom,
    cancelTestsMutationAtom,
    displayedVariantsAtom,
} from "../../../../state/atoms"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"
import SharedEditor from "../../../SharedEditor"
import GenerationOutputText from "../GenerationOutputText"

import {useStyles} from "./styles"
import type {GenerationCompletionRowProps} from "./types"

const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {
    ssr: false,
})
const GenerationVariableOptions = dynamic(() => import("../GenerationVariableOptions"), {
    ssr: false,
})

const handleChange = () => undefined

const GenerationCompletionRow = ({
    variantId,
    rowId,
    className,
    inputOnly,
    view,
    disabled,
    ...props
}: GenerationCompletionRowProps) => {
    const classes = useStyles()

    // ATOM-LEVEL OPTIMIZATION: Use focused atoms for generation result data
    // Memoize atoms to prevent infinite re-renders
    const generationResultAtom = useMemo(
        () => generationResultAtomFamily({variantId, rowId}),
        [variantId, rowId],
    )

    const {resultHash, isRunning} = useAtomValue(generationResultAtom)

    const isChat = useAtomValue(appChatModeAtom)
    const {isComparisonView} = usePlaygroundLayout()
    const viewType = isComparisonView ? "comparison" : "single"

    // Prefer revision-scoped variables from new prompts system when we have a concrete revisionId (variantId)
    // Avoid conditional hooks by using a noop atom if variantId is not provided
    const singleVariantVarsAtom = useMemo(
        () => (variantId ? promptVariablesAtomFamily(variantId) : atom<string[]>([])),
        [variantId],
    )
    const singleVariantVariables = useAtomValue(singleVariantVarsAtom)
    const displayedVariables = useAtomValue(displayedVariantsVariablesAtom)
    // Also include any variables already present in the normalized row for this revision
    const normalizedRowVars = useAtomValue(
        useMemo(
            () => rowVariablesForDisplayAtomFamily({rowId, revisionId: variantId || ""}),
            [rowId, variantId],
        ),
    ) as any[] | null
    // Fallback: if row-scoped vars are empty, read all normalized vars for this revision (aggregated)
    const allNodesForRevision = useAtomValue(
        useMemo(
            () => variablesByRevisionSelectorFamily({revisionId: variantId || ""}),
            [variantId],
        ),
    ) as any[]
    // In comparison view, aggregate normalized variables across displayed revisions
    const displayedRevIds = useAtomValue(displayedVariantsAtom) as string[]
    const schemaKeys = useAtomValue(schemaInputKeysAtom) as string[]
    const flags = useAtomValue(
        useMemo(() => variantFlagsAtomFamily({revisionId: variantId}), [variantId]),
    ) as any
    const aggregatedDisplayedNormVars = useAtomValue(
        useMemo(
            () =>
                atom((get) => {
                    const ids = Array.isArray(displayedRevIds) ? displayedRevIds : []
                    const set = new Set<string>()
                    ids.forEach((rid) => {
                        const raw = get(
                            rowVariablesForDisplayAtomFamily({rowId, revisionId: rid}),
                        ) as any
                        // Normalize to an array of variable nodes regardless of shape
                        const list: any[] = Array.isArray(raw)
                            ? raw
                            : raw && typeof raw === "object"
                              ? Object.values(raw)
                              : []
                        list.forEach((n: any) => {
                            const id = n && typeof n === "object" ? (n?.key ?? n?.__id) : undefined
                            if (typeof id === "string" && id) set.add(id)
                        })
                    })
                    return Array.from(set)
                }),
            [displayedRevIds, rowId],
        ),
    ) as string[]
    // Helper to detect UUID-like ids so we can prefer human-friendly names when aggregating
    const isUuid = (s: any) =>
        typeof s === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

    const variableIds = useMemo(() => {
        // For custom workflows, strictly use schema input keys only.
        if (flags?.isCustom) {
            return Array.isArray(schemaKeys) ? Array.from(new Set(schemaKeys)) : []
        }

        // Completion (single view): stabilize to prompt vars + existing row vars
        if (!isChat && viewType === "single") {
            const a = Array.isArray(singleVariantVariables) ? singleVariantVariables : []
            const c = Array.isArray(normalizedRowVars)
                ? (normalizedRowVars as any[]).map((n: any) => n?.key ?? n?.__id).filter(Boolean)
                : []
            return Array.from(new Set([...(a || []), ...(c || [])]))
        }

        // Chat or comparison: favor prompt-derived variables and filter out UUID-like ids
        const a = Array.isArray(singleVariantVariables) ? singleVariantVariables : []
        const b = Array.isArray(displayedVariables) ? displayedVariables : []
        const cRaw = Array.isArray(normalizedRowVars)
            ? (normalizedRowVars as any[]).map((n: any) => n?.key ?? n?.__id).filter(Boolean)
            : []
        const dRaw = Array.isArray(aggregatedDisplayedNormVars) ? aggregatedDisplayedNormVars : []
        const c = cRaw.filter((x) => !isUuid(x as any))
        const d = dRaw.filter((x) => !isUuid(x as any))
        // Start with prompt-derived lists (a, b), then add normalized-derived (c, d)
        return Array.from(new Set([...(a || []), ...(b || []), ...(c || []), ...(d || [])]))
    }, [
        flags?.isCustom,
        schemaKeys,
        singleVariantVariables,
        displayedVariables,
        normalizedRowVars,
        aggregatedDisplayedNormVars,
        isChat,
        viewType,
    ])

    // Map normalized variables to a value lookup by __id so we can pass it down explicitly
    const normalizedValueById = useMemo(() => {
        const map: Record<string, string> = {}
        const list: any[] = Array.isArray(normalizedRowVars)
            ? (normalizedRowVars as any[])
            : normalizedRowVars && typeof normalizedRowVars === "object"
              ? Object.values(normalizedRowVars as any)
              : []
        for (const n of list) {
            const k = n?.__id
            if (!k) continue
            const v = n?.content?.value ?? n?.value
            map[k] = v !== undefined && v !== null ? String(v) : ""
        }
        return map
    }, [normalizedRowVars])

    // Name-based lookup for completion UI (key preferred, fallback to __id)
    const normalizedValueByName = useMemo(() => {
        const map: Record<string, string> = {}
        const list: any[] = Array.isArray(normalizedRowVars)
            ? (normalizedRowVars as any[])
            : normalizedRowVars && typeof normalizedRowVars === "object"
              ? Object.values(normalizedRowVars as any)
              : []
        for (const n of list) {
            const name = (n as any)?.key ?? (n as any)?.__id
            if (!name) continue
            const v = (n as any)?.content?.value ?? (n as any)?.value
            map[String(name)] = v !== undefined && v !== null ? String(v) : ""
        }
        return map
    }, [normalizedRowVars])

    // Build a clean list of variable items to render (id, __id, val)
    const variableItems = useMemo(() => {
        // Completion: render strictly from variableIds to avoid transient drops during edits
        if (!isChat) {
            return (variableIds || []).map((id) => ({
                id,
                __id: id,
                val: normalizedValueByName[id] ?? "",
            }))
        }

        // Chat: keep richer fallbacks
        const normList: any[] = Array.isArray(normalizedRowVars)
            ? (normalizedRowVars as any[])
            : normalizedRowVars && typeof normalizedRowVars === "object"
              ? Object.values(normalizedRowVars as any)
              : []
        const fallbackList: any[] = Array.isArray(allNodesForRevision) ? allNodesForRevision : []

        if (normList.length > 0) {
            return normList.map((n) => ({
                id: (n as any)?.key ?? (n as any)?.__id,
                __id: (n as any)?.__id,
                val:
                    (n as any)?.content?.value !== undefined
                        ? (n as any)?.content?.value
                        : ((n as any)?.value ?? ""),
            }))
        }
        if (fallbackList.length > 0) {
            return fallbackList.map((n: any) => ({
                id: n?.key ?? n?.__id,
                __id: n?.__id,
                val: n?.content?.value !== undefined ? n?.content?.value : (n?.value ?? ""),
            }))
        }
        return (variableIds || []).map((id) => ({id, __id: id, val: normalizedValueById[id] ?? ""}))
    }, [isChat, normalizedRowVars, allNodesForRevision, variableIds, normalizedValueById])

    const triggerTest = useSetAtom(triggerWebWorkerTestAtom)
    const cancelTests = useSetAtom(cancelTestsMutationAtom)
    const displayedVariantIds = useAtomValue(displayedVariantsAtom)

    useLazyEffect(() => {
        if (!isChat) return

        const timer = autoScrollToBottom()
        return timer
    }, [resultHash, isChat])

    const result = useMemo(() => {
        return getResponseLazy(resultHash)
    }, [resultHash])

    const runRow = useCallback(async () => {
        // In comparison view with no explicit variantId, trigger for all displayed variants
        if (!variantId && Array.isArray(displayedVariantIds) && displayedVariantIds.length > 0) {
            displayedVariantIds.forEach((vid) => triggerTest({rowId, variantId: vid} as any))
            return
        }
        // Single view or explicit variant run
        triggerTest({rowId, variantId: variantId as string})
    }, [triggerTest, rowId, variantId, displayedVariantIds])

    const cancelRow = useCallback(async () => {
        const variantIds = viewType === "single" && variantId ? [variantId] : displayedVariantIds
        await cancelTests({variantIds, reason: "user_cancelled"} as any)
    }, [cancelTests, displayedVariantIds, variantId, viewType])

    // Show variables section when in single view and not in focus mode
    // When view is undefined, it's considered normal view (not focus)
    if (viewType === "single" && view !== "focus" && variantId) {
        // Normalize API response content across backends
        const raw = (result as any)?.response?.data
        // Prefer direct string; otherwise check known shapes: {content}, {data}
        const contentCandidate =
            typeof raw === "string"
                ? raw
                : raw && typeof raw === "object"
                  ? ((raw as any).content ?? (raw as any).data ?? "")
                  : ""

        let isJSON = false
        let displayValue = contentCandidate
        if (typeof contentCandidate === "string") {
            try {
                const parsed = JSON5.parse(contentCandidate)
                isJSON = true
                // SharedEditor/Editor expects a string initialValue even in code mode
                displayValue = JSON.stringify(parsed, null, 2)
            } catch {
                isJSON = false
            }
        }

        return (
            <div
                className={clsx([
                    "flex flex-col",
                    "p-4",
                    "group/item",
                    {"gap-4": variableIds.length > 0},
                    classes.container,
                ])}
                {...props}
            >
                <div
                    className={clsx("flex gap-1 items-start", {
                        "flex flex-col gap-4 w-full": isChat,
                    })}
                >
                    {variableIds.length > 0 && (
                        <>
                            <div className="w-[100px] shrink-0">
                                <Typography className="font-[500] text-[12px] leading-[20px]">
                                    Variables
                                </Typography>
                            </div>
                            <div className="flex flex-col grow gap-2 w-full">
                                {variableItems.map(({__id, id, val}) => {
                                    const allowedSet = new Set(
                                        Array.isArray(schemaKeys) ? schemaKeys : [],
                                    )
                                    const disableForCustom = Boolean(
                                        flags?.isCustom && !allowedSet.has(id),
                                    )
                                    return (
                                        <div
                                            key={id}
                                            className={clsx([
                                                "relative group/item px-3 py-2",
                                                {
                                                    "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]":
                                                        isChat && viewType === "comparison",
                                                    "!px-0 !py-0": viewType === "comparison",
                                                },
                                            ])}
                                        >
                                            <PlaygroundVariantPropertyControl
                                                variantId={variantId}
                                                propertyId={id}
                                                rowId={rowId}
                                                className={clsx([
                                                    "*:!border-none",
                                                    {
                                                        "rounded-none [&_article]:px-3 [&_article]:py-1 px-3":
                                                            viewType === "comparison",
                                                    },
                                                ])}
                                                disabled={disableForCustom}
                                                placeholder={
                                                    disableForCustom
                                                        ? "Insert a {{ variable }} in your template to create an input."
                                                        : "Enter value"
                                                }
                                                editorProps={{enableTokens: false}}
                                                value={val}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                        </>
                    )}
                    {/** When there are no variables in single view, still expose row options */}
                    {!inputOnly && variableIds.length === 0 ? (
                        <div className="w-full">
                            <GenerationVariableOptions
                                variantId={variantId as string}
                                rowId={rowId}
                                className="invisible group-hover/item:visible"
                                resultHash={resultHash}
                            />
                        </div>
                    ) : null}

                    {/** Row-level options (single view): when there are no variables, show actions at right */}
                    {!inputOnly && (
                        <GenerationVariableOptions
                            variantId={variantId as string}
                            rowId={rowId}
                            className="invisible group-hover/item:visible"
                            resultHash={resultHash}
                        />
                    )}
                </div>
                <div className="w-full flex gap-4">
                    {!inputOnly ? (
                        <div className={clsx("h-[48px] flex items-center px-4 mt-2")}>
                            {!isRunning ? (
                                <RunButton
                                    onClick={runRow}
                                    disabled={!!isRunning}
                                    className="flex"
                                />
                            ) : (
                                <RunButton isCancel onClick={cancelRow} className="flex" />
                            )}
                        </div>
                    ) : null}

                    {/* Response panel */}
                    {!inputOnly && (
                        <div
                            className={clsx([
                                "w-full flex flex-col gap-4 pr-4 pl-2 pb-2",
                                {"max-w-[calc(100%-158px)]": viewType !== "comparison" && !isChat},
                                {"max-w-[100%]": viewType === "comparison"},
                            ])}
                        >
                            {isRunning ? (
                                <GenerationOutputText text="Running..." />
                            ) : !result ? (
                                <GenerationOutputText
                                    text="Click run to generate output"
                                    isPlaceholder
                                />
                            ) : result.error ? (
                                <SharedEditor
                                    initialValue={result?.error}
                                    editorType="borderless"
                                    state="filled"
                                    readOnly
                                    disabled
                                    error
                                    className={clsx(["w-full"])}
                                    editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                    footer={
                                        <GenerationResultUtils className="mt-2" result={result} />
                                    }
                                    handleChange={handleChange}
                                />
                            ) : result.response ? (
                                (() => {
                                    const rawData = (result as any)?.response?.data
                                    // Priority 1: contentCandidate if it's a stringified array
                                    if (typeof contentCandidate === "string") {
                                        const t = contentCandidate.trim()
                                        if (t.startsWith("[") || t.startsWith("{")) {
                                            const parsed = JSON5.parse(contentCandidate)
                                            if (Array.isArray(parsed)) {
                                                return (
                                                    <ToolCallView
                                                        resultData={parsed}
                                                        className="w-full"
                                                        footer={
                                                            <GenerationResultUtils
                                                                className="mt-2"
                                                                result={result}
                                                            />
                                                        }
                                                    />
                                                )
                                            }
                                        }
                                    }
                                    // Priority 2: contentCandidate is already an array
                                    if (Array.isArray(contentCandidate)) {
                                        return (
                                            <ToolCallView
                                                resultData={contentCandidate}
                                                className="w-full"
                                                footer={
                                                    <GenerationResultUtils
                                                        className="mt-2"
                                                        result={result}
                                                    />
                                                }
                                            />
                                        )
                                    }
                                    // Priority 3: direct response data is stringified array
                                    if (typeof rawData === "string") {
                                        const t = rawData.trim()
                                        if (t.startsWith("[") || t.startsWith("{")) {
                                            const parsed = JSON5.parse(rawData)
                                            if (Array.isArray(parsed)) {
                                                return (
                                                    <ToolCallView
                                                        resultData={parsed}
                                                        className="w-full"
                                                        footer={
                                                            <GenerationResultUtils
                                                                className="mt-2"
                                                                result={result}
                                                            />
                                                        }
                                                    />
                                                )
                                            }
                                        }
                                    }
                                    // Priority 4: direct response data is array
                                    if (Array.isArray(rawData)) {
                                        return (
                                            <ToolCallView
                                                resultData={rawData}
                                                className="w-full"
                                                footer={
                                                    <GenerationResultUtils
                                                        className="mt-2"
                                                        result={result}
                                                    />
                                                }
                                            />
                                        )
                                    }
                                    // Fallback: default editor rendering
                                    return (
                                        <SharedEditor
                                            initialValue={displayValue}
                                            editorType="borderless"
                                            state="filled"
                                            readOnly
                                            editorProps={{
                                                codeOnly: isJSON,
                                            }}
                                            disabled
                                            editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                            footer={
                                                <GenerationResultUtils
                                                    className="mt-2"
                                                    result={result}
                                                />
                                            }
                                            handleChange={handleChange}
                                        />
                                    )
                                })()
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <>
            <div
                className={clsx([
                    "flex flex-col gap-4",
                    {"max-w-[calc(100%-158px)]": viewType !== "comparison" && !isChat},
                    {"max-w-[100%]": viewType === "comparison"},
                ])}
                {...props}
            >
                <div className="flex gap-1 items-start">
                    <div className="flex flex-col grow">
                        {variableIds.map((variableId) => {
                            return (
                                <div
                                    key={variableId}
                                    className={clsx([
                                        "relative group/item px-3 py-2",
                                        {
                                            "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]":
                                                isChat && viewType === "comparison",
                                            "!px-0 !py-0": viewType === "comparison",
                                        },
                                    ])}
                                >
                                    <PlaygroundVariantPropertyControl
                                        variantId={variantId}
                                        propertyId={variableId}
                                        view={view}
                                        rowId={rowId}
                                        className={clsx([
                                            "*:!border-none",
                                            {
                                                "rounded-none [&_article]:px-3 [&_article]:py-1 px-3":
                                                    viewType === "comparison",
                                            },
                                        ])}
                                        disabled={disabled}
                                        placeholder="Enter value"
                                        editorProps={{enableTokens: false}}
                                    />

                                    {!inputOnly && (
                                        <GenerationVariableOptions
                                            variantId={variantId as string}
                                            rowId={rowId}
                                            className="invisible group-hover/item:visible absolute top-5 right-5"
                                            resultHash={resultHash}
                                            variableId={variableId}
                                        />
                                    )}
                                </div>
                            )
                        })}

                        {/** When there are no variables, still show row options (completion apps) */}
                        {!inputOnly && variableIds.length === 0 ? (
                            <GenerationVariableOptions
                                variantId={variantId as string}
                                rowId={rowId}
                                className="invisible group-hover/item:visible"
                                resultHash={resultHash}
                            />
                        ) : (
                            <></>
                        )}
                    </div>
                </div>
            </div>

            {!inputOnly ? (
                <div className={clsx("h-[48px] flex items-center px-4")}>
                    {!isRunning ? (
                        <RunButton onClick={runRow} disabled={!!isRunning} className="flex" />
                    ) : (
                        <RunButton isCancel onClick={cancelRow} className="flex" />
                    )}
                </div>
            ) : null}
        </>
    )
}

export default GenerationCompletionRow
