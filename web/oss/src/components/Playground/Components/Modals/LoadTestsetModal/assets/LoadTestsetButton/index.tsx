import {cloneElement, isValidElement, SetStateAction, useState} from "react"

import {Database} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {loadTestsetDataMutationAtom, appChatModeAtom} from "@/oss/components/Playground/state/atoms"

import {LoadTestsetButtonProps} from "./types"

const LoadTestsetModal = dynamic(() => import("../.."), {ssr: false})

const LoadTestsetButton = ({
    label,
    icon = false,
    children,
    variantId,
    ...props
}: LoadTestsetButtonProps) => {
    const loadTestsetData = useSetAtom(loadTestsetDataMutationAtom)
    const isChat = useAtomValue(appChatModeAtom) ?? false

    const [isTestsetModalOpen, setIsTestsetModalOpen] = useState(false)
    const [testsetData, setTestsetData] = useState<Record<string, any> | null>(null)

    const wrappedSetTestsetData = (d: SetStateAction<Record<string, any> | null>) => {
        // Only call the mutation if we have valid testset data
        if (d && Array.isArray(d) && d.length > 0) {
            // Use the new mutation atom to load testset data
            loadTestsetData({
                testsetData: d,
                isChatVariant: isChat,
            })
        } else if (d && !Array.isArray(d)) {
            // Handle single testset item
            loadTestsetData({
                testsetData: [d],
                isChatVariant: isChat,
            })
        }

        // Update local state for the modal
        setTestsetData(d)
    }

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
