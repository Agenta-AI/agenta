import {memo, useState} from "react"

import {Play} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {currentAppAtom} from "@/oss/state/app"

import {usePlaygroundLayout} from "../../hooks/usePlaygroundLayout"

const NewEvaluationModal = dynamic(
    () => import("@/oss/components/pages/evaluations/NewEvaluation"),
    {ssr: false},
)

interface RunEvaluationButtonProps {
    className?: string
}

/**
 * Button component that opens the NewEvaluationModal with pre-selected variants
 * from the current playground session. Allows users to quickly start an evaluation
 * run with the variants they're currently comparing in the playground.
 */
const RunEvaluationButton: React.FC<RunEvaluationButtonProps> = ({className}) => {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const {displayedVariants} = usePlaygroundLayout()
    const currentApp = useAtomValue(currentAppAtom)

    const hasVariants = displayedVariants.length > 0

    return (
        <>
            <Button
                variant="outlined"
                color="default"
                icon={<Play size={14} />}
                className={clsx("self-start", className)}
                disabled={!hasVariants}
                onClick={() => setIsModalOpen(true)}
                size="small"
            >
                Run Evaluation
            </Button>

            <NewEvaluationModal
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                onSuccess={() => setIsModalOpen(false)}
                evaluationType="auto"
                preview={false}
                preSelectedVariantIds={displayedVariants}
                preSelectedAppId={currentApp?.app_id}
            />
        </>
    )
}

export default memo(RunEvaluationButton)
