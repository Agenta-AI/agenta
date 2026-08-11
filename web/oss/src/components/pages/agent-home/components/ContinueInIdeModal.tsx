import {App, Button, Modal, Typography} from "antd"
import {Copy} from "lucide-react"

import {buildIdeCommand, COMPOSER} from "../assets/constants"

const {Text} = Typography

/**
 * The IDE-handoff modal — the DEFAULT "Continue in IDE" behavior (the playground-native onboarding uses
 * a streamed chat bubble instead, behind its env flag). Shows the install command + the user's prompt
 * with a Copy button. Declarative antd `Modal` so it inherits the app theme (dark-safe, unlike the
 * static `Modal.*` helpers).
 */
const ContinueInIdeModal = ({
    open,
    prompt,
    onClose,
}: {
    open: boolean
    prompt: string
    onClose: () => void
}) => {
    const {message} = App.useApp()
    const command = buildIdeCommand(prompt)

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(command)
            message.success("Copied install command + prompt to your clipboard")
        } catch {
            message.error("Couldn't copy to clipboard")
        }
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            centered
            width={560}
            title="Continue in your IDE"
        >
            <div className="flex flex-col gap-3 pt-1">
                <Text type="secondary" className="!text-xs !leading-relaxed">
                    {COMPOSER.helperIde}
                </Text>
                <pre className="m-0 max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] p-3 font-mono text-[12px] leading-relaxed text-[var(--ag-colorText)]">
                    {command}
                </pre>
                <div className="flex justify-end">
                    <Button type="primary" icon={<Copy size={14} />} onClick={copy}>
                        {COMPOSER.copyPrompt}
                    </Button>
                </div>
            </div>
        </Modal>
    )
}

export default ContinueInIdeModal
