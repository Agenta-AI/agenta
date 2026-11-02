/**
 * Destructive confirmation, supplied by the host — the desktop's `AlertPopup`, a sheet on `/m`.
 *
 * One definition rather than one per section: the shape was copied into four files and had
 * already drifted (`onOk` typed as `Promise<void>` in one of them, so a synchronous handler was
 * rejected there and nowhere else).
 */
export type ConfirmDestructive = (args: {
    title: string
    message: string
    /**
     * The confirming button's label. Naming the act rather than answering "Yes" is what lets a
     * reader tell two destructive verbs apart once the dialog has covered the menu they came
     * from. Hosts fall back to their own default when it is absent.
     */
    okText?: string
    /** Style the confirming button as destructive. */
    danger?: boolean
    onOk: () => void | Promise<void>
}) => void
