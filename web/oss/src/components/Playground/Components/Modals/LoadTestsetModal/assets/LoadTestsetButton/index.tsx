import {cloneElement, isValidElement, SetStateAction, useCallback, useState} from "react"

import {Database} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {appChatModeAtom} from "@/oss/components/Playground/state/atoms"
import {loadTestsetNormalizedMutationAtom} from "@/oss/state/newPlayground/generation/mutations"

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
    const [testsetData, setTestsetData] = useState<Record<string, any> | null>(null)

    const wrappedSetTestsetData = useCallback(
        (d: SetStateAction<Record<string, any> | null>) => {
            // Only call the mutation if we have valid testset data
            if (d && Array.isArray(d) && d.length > 0) {
                // Use the new mutation atom to load testset data
                loadTestsetData({
                    testsetData: d,
                    isChatVariant: isChat,
                    regenerateVariableIds: true,
                })
            } else if (d && !Array.isArray(d)) {
                // Handle single testset item
                loadTestsetData({
                    testsetData: [d],
                    isChatVariant: isChat,
                    regenerateVariableIds: true,
                })
            }

            // Update local state for the modal
            setTestsetData(d)
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
                testsetData={testsetData}
                setTestsetData={wrappedSetTestsetData}
                isChat={isChat}
            />
        </>
    )
}

export default LoadTestsetButton
