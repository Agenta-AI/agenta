import type {useComposerAttachments} from "@agenta/chat/hooks"

/** What creating needs, shared by the blank start and the template creator. */
export interface OnboardingCreateState {
    /** A runnable model is selected. */
    modelReady: boolean
    creating: boolean
    error?: string | null
    /** Files staged in the composer; they ride into the create with the first message. */
    attachments: ReturnType<typeof useComposerAttachments>
    /** Resolves `false` when no agent was created. */
    onCreate: (firstMessage: string) => Promise<boolean>
    onChooseModel: () => void
}
