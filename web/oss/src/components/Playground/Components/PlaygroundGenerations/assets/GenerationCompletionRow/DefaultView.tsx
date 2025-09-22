import {useMemo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import VariableControlAdapter from "@/oss/components/Playground/adapters/VariableControlAdapter"
import RunButton from "@/oss/components/Playground/assets/RunButton"
import {variableIdsUnifiedAtomFamily} from "@/oss/state/newPlayground/generation/selectors"

const GenerationVariableOptions = dynamic(() => import("../GenerationVariableOptions"), {
    ssr: false,
})

interface Props {
    rowId: string
    variantId?: string
    isChat: boolean
    viewType: "single" | "comparison"
    view?: string
    disabled?: boolean
    inputOnly?: boolean
    resultHash: string | null
    runRow: () => void
    cancelRow: () => void
    isBusy: boolean
}

const DefaultView = ({
    rowId,
    variantId,
    isChat,
    viewType,
    view,
    disabled,
    inputOnly,
    resultHash,
    runRow,
    cancelRow,
    isBusy,
}: Props) => {
    const variableIds = useAtomValue(
        useMemo(
            () => variableIdsUnifiedAtomFamily({rowId, revisionId: variantId || ""}),
            [rowId, variantId],
        ),
    ) as string[]

    return (
        <>
            <div
                className={clsx([
                    "flex flex-col gap-4",
                    {"max-w-[calc(100%-158px)]": viewType !== "comparison" && !isChat},
                    {"max-w-[100%]": viewType === "comparison"},
                ])}
            >
                <div className="flex gap-1 items-start">
                    <div className="flex flex-col grow">
                        {variableIds.map((variableId) => (
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
                                <VariableControlAdapter
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
                        ))}

                        {!inputOnly && variableIds.length === 0 ? (
                            <GenerationVariableOptions
                                variantId={variantId as string}
                                rowId={rowId}
                                className="invisible group-hover/item:visible"
                                resultHash={resultHash}
                            />
                        ) : null}
                    </div>
                </div>
            </div>

            {!inputOnly ? (
                <div className={clsx("h-[48px] flex items-center px-4")}>
                    {isBusy ? (
                        <RunButton isCancel onClick={cancelRow} className="flex" />
                    ) : (
                        <RunButton onClick={runRow} className="flex" />
                    )}
                </div>
            ) : null}
        </>
    )
}

export default DefaultView
