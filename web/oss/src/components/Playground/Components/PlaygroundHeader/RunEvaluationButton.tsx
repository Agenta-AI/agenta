import {memo, useState} from "react"

import {usePlaygroundLayout} from "@agenta/playground-ui/hooks"
import {Flask} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {currentAppAtom} from "@/oss/state/app"

const NewEvaluationModal = dynamic(
    () => import("@/oss/components/pages/evaluations/NewEvaluation"),
    {ssr: false},
)

interface RunEvaluationButtonProps {
    className?: string
}

/**
 * Button component that opens the NewEvaluationModal with pre-selected entities
 * from the current playground session. Allows users to quickly start an evaluation
 * run with the entities they're currently comparing in the playground.
 */
const RunEvaluationButton: React.FC<RunEvaluationButtonProps> = ({className}) => {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const {displayedEntities} = usePlaygroundLayout()
    const currentApp = useAtomValue(currentAppAtom)

    const hasEntities = displayedEntities.length > 0
    // Project-scoped playground has no current app — evaluation creation
    // requires an app target, so the button is disabled in that context.
    const isProjectScoped = !currentApp
    const isDisabled = !hasEntities || isProjectScoped

    return (
        <>
            <Tooltip
                title={
                    isProjectScoped
                        ? "Open this trace from an app's playground to create an evaluation."
                        : "Run your prompt against a full test set with evaluators. Results are saved to the Evaluations page."
                }
            >
                <Button
                    type="text"
                    icon={<Flask size={14} />}
                    className={clsx("self-start", className)}
                    disabled={isDisabled}
                    data-tour="run-evaluation-button"
                    onClick={() => setIsModalOpen(true)}
                    size="small"
                >
                    New Evaluation
                </Button>
            </Tooltip>

            <NewEvaluationModal
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                onSuccess={() => setIsModalOpen(false)}
                evaluationType="auto"
                preview={false}
                preSelectedVariantIds={displayedEntities}
                preSelectedAppId={currentApp?.id}
            />
        </>
    )
}

export default memo(RunEvaluationButton)
