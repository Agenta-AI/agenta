import {Play} from "@phosphor-icons/react"
import {Modal} from "antd"
import {useRouter} from "next/router"

import {InstructionModalProps} from "../types"

const InstructionModal = ({...props}: InstructionModalProps) => {
    const router = useRouter()
    const isAbTesting = router.pathname.includes("a_b_testing")

    return (
        <Modal title="Instructions" centered {...props} footer={null}>
            <ol className="flex flex-col gap-2 py-2 px-5">
                <li>
                    Use the buttons <b>Next</b> and <b>Prev</b> or the arrow keys{" "}
                    <code>{`Left (<)`}</code> and <code>{`Right (>)`}</code> to navigate between
                    scenarios.
                </li>
                <li>
                    Click the <b>Run</b> <Play size={14} className="-mb-0.5" /> button or press{" "}
                    <code>{`Meta+Enter (⌘+↵)`}</code> or <code>{`Ctrl+Enter`}</code> to run the
                    scenario.
                </li>
                {isAbTesting && (
                    <li>
                        <b>Vote</b> by either clicking the evaluation buttons at the right sidebar
                        or pressing the key <code>a</code> for 1st Variant, <code>b</code> for 2nd
                        Variant and <code>x</code> if both are bad.
                    </li>
                )}
                <li>Annotate the scenario</li>
            </ol>
        </Modal>
    )
}

export default InstructionModal
