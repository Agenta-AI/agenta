export interface PromptsFixtures {
    /** Navigates to the Prompts page and verifies it is displayed. */
    navigateToPrompts: () => Promise<void>

    /** Opens the "New prompt" modal via the Create new dropdown and creates a prompt. */
    createNewPrompt: (promptName: string) => Promise<void>

    /** Opens the "New folder" modal via the Create new dropdown and creates a folder. */
    createNewFolder: (folderName: string) => Promise<void>
}
