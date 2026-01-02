import {cloneElement, isValidElement, useCallback, useState} from "react"

import {Database} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {appChatModeAtom} from "@/oss/components/Playground/state/atoms"
import {loadTestsetNormalizedMutationAtom} from "@/oss/components/Playground/state/atoms/mutations/testset/loadNormalized"

import {LoadTestsetSelectionPayload} from "../types"

import {LoadTestsetButtonProps} from "./types"

const LoadTestsetModal = dynamic(() => import("../.."), {ssr: false})

const LoadTestsetButton = ({
    label,
    icon = false,
    children,
    variantId,
    ...props
}: LoadTestsetButtonProps) => {
    const loadTestsetData = useSetAtom(loadTestsetNormalizedMutationAtom)
    const isChat = useAtomValue(appChatModeAtom) ?? false

    const [isTestsetModalOpen, setIsTestsetModalOpen] = useState(false)
    const [, setTestsetData] = useState<LoadTestsetSelectionPayload | null>(null)

    const wrappedSetTestsetData = useCallback(
        (payload: LoadTestsetSelectionPayload | null) => {
            const testcases = payload?.testcases ?? []
            if (Array.isArray(testcases) && testcases.length > 0) {
                loadTestsetData({
                    testsetData: testcases,
                    isChatVariant: isChat,
                    regenerateVariableIds: true,
                })
            }

            setTestsetData(payload)
        },
        [loadTestsetData, isChat],
    )

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsTestsetModalOpen(true)
                        },
                    },
                )
            ) : (
                <Button
                    size="small"
                    icon={icon && <Database size={14} />}
                    onClick={() => setIsTestsetModalOpen(true)}
                    {...props}
                >
                    {label}
                </Button>
            )}

            <LoadTestsetModal
                open={isTestsetModalOpen}
                onCancel={() => setIsTestsetModalOpen(false)}
                setTestsetData={wrappedSetTestsetData}
            />
        </>
    )
}

export default LoadTestsetButton
