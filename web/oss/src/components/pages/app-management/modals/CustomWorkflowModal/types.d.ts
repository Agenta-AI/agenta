import {Modal} from "antd"

export type CustomWorkflowModalProps = {
    open: boolean
    /** App ID — present = configure mode, absent/empty = create mode */
    appId?: string | null
    onCancel: () => void
    /** Called after successful create or configure-save */
    onSuccess?: () => Promise<void>
    /** Called to trigger template creation (create mode only) */
    onCreateApp?: () => void
} & Omit<React.ComponentProps<typeof Modal>, "open" | "onCancel">
