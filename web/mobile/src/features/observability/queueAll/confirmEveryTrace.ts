import {modal} from "@agenta/ui/app-message"

/** Asks before a scan with no filter; resolves `true` when the user agrees to queue every trace. */
export const confirmEveryTrace = () =>
    new Promise<boolean>((resolve) => {
        modal.confirm({
            title: "Add every trace to the queue?",
            content: "No filter is active. This will queue every trace in the project. Continue?",
            okText: "Continue",
            cancelText: "Cancel",
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        })
    })
