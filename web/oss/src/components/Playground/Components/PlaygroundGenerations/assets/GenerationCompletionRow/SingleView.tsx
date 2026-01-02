import {useEffect, useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"
import dynamic from "next/dynamic"

import VariableControlAdapter from "@/oss/components/Playground/adapters/VariableControlAdapter"
import RunButton from "@/oss/components/Playground/assets/RunButton"
import TypingIndicator from "@/oss/components/Playground/assets/TypingIndicator"
import {variableIdsUnifiedAtomFamily} from "@/oss/state/newPlayground/generation/selectors"
import {repetitionIndexAtomFamily} from "@/oss/state/newPlayground/generation/uiState"

import {ClickRunPlaceholder} from "../ResultPlaceholder"

import ErrorPanel from "./ErrorPanel"
import GenerationResponsePanel from "./GenerationResponsePanel"

const GenerationVariableOptions = dynamic(() => import("../GenerationVariableOptions"), {
    ssr: false,
})

interface Props {
    rowId: string
    variantId: string
    isChat: boolean
    isBusy: boolean
    isRunning: boolean
    inputOnly?: boolean
    result: any
    resultHash: string | null
    runRow: () => void
    cancelRow: () => void
    containerClassName?: string
}

const SingleView = ({
    rowId,
    variantId,
    isChat,
    isBusy,
    isRunning,
    inputOnly,
    result,
    resultHash,
    runRow,
    cancelRow,
    containerClassName,
}: Props) => {
    // UI State for repetition index
    const [repetitionIndex, setRepetitionIndex] = useAtom(
        useMemo(() => repetitionIndexAtomFamily(`${rowId}:${variantId}`), [rowId, variantId]),
    )

    const variableIds = useAtom(
        useMemo(
            () => variableIdsUnifiedAtomFamily({rowId, revisionId: variantId}),
            [rowId, variantId],
        ),
    )[0] as string[]

    useEffect(() => {
        setRepetitionIndex(0)
    }, [resultHash, setRepetitionIndex])

    const totalRepetitions = Array.isArray(result) ? result.length : result ? 1 : 0
    const safeIndex =
        repetitionIndex >= totalRepetitions ? Math.max(0, totalRepetitions - 1) : repetitionIndex
    const currentResult =
        Array.isArray(result) && totalRepetitions > 0
            ? result[safeIndex]
            : totalRepetitions === 1
              ? result
              : null

    const repetitionProps =
        totalRepetitions > 1
            ? {
                  current: safeIndex + 1,
                  total: totalRepetitions,
                  onNext: () =>
                      setRepetitionIndex((prev) => Math.min(totalRepetitions - 1, prev + 1)),
                  onPrev: () => setRepetitionIndex((prev) => Math.max(0, prev - 1)),
              }
            : undefined

    return (
        <div
            className={clsx([
                "flex flex-col",
                "p-4",
                "group/item",
                {"gap-4": variableIds.length > 0},
                containerClassName,
            ])}
        >
            <div className={clsx("flex gap-1 items-start", {"flex flex-col gap-4 w-full": isChat})}>
                {variableIds.length > 0 && (
                    <>
                        <div className="shrink-0 top-[48px] sticky bg-colorBgContainer z-[10] w-[100px]">
                            <Typography className="font-[500] text-[12px] leading-[20px]">
                                Variables
                            </Typography>
                        </div>
                        <div className="flex flex-col grow gap-2 w-full">
                            {variableIds.map((id) => {
                                return (
                                    <div
                                        key={id}
                                        className={clsx(["relative group/item px-0 py-2"])}
                                    >
                                        <VariableControlAdapter
                                            variantId={variantId}
                                            propertyId={id}
                                            key={id}
                                            rowId={rowId}
                                            className={clsx(["*:!border-none"])}
                                            // disabled={disableForCustom}
                                            // placeholder={
                                            //     disableForCustom
                                            //         ? "Insert a {{variable}} in your template to create an input."
                                            //         : "Enter value"
                                            // }
                                            editorProps={{enableTokens: false}}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    </>
                )}
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

                {!inputOnly && (
                    <GenerationVariableOptions
                        variantId={variantId as string}
                        rowId={rowId}
                        className="invisible group-hover/item:visible"
                        resultHash={resultHash}
                    />
                )}
            </div>
            {!inputOnly ? (
                <div className="w-full flex gap-1">
                    <div
                        className={clsx("flex items-start justify-start h-fit w-[100px] shrink-0")}
                    >
                        {!isBusy ? (
                            <RunButton onClick={runRow} disabled={!!isRunning} className="flex" />
                        ) : (
                            <RunButton isCancel onClick={cancelRow} className="flex" />
                        )}
                    </div>

                    <div className={clsx(["w-full flex flex-col gap-4  pb-2 mr-[52px]"])}>
                        {isBusy ? (
                            <TypingIndicator />
                        ) : !currentResult ? (
                            <ClickRunPlaceholder />
                        ) : (
                            <div className="flex flex-col gap-2">
                                {currentResult.error ? (
                                    <ErrorPanel result={currentResult} />
                                ) : currentResult.response ? (
                                    <GenerationResponsePanel
                                        key={safeIndex}
                                        result={currentResult}
                                        repetitionProps={repetitionProps}
                                    />
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export default SingleView
