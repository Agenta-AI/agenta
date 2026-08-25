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
    onOk: () => void | Promise<void>
}) => void

export interface DestructiveConfirmProps {
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: ConfirmDestructive
}
