/**
 * The session bar's files-pane glyph: a panel whose right strip is FILLED while the pane is
 * open and outlined while it is closed. The icon never moves — its fill is the state.
 */
export const FilesPaneIcon = ({open, size = 14}: {open: boolean; size?: number}) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
    >
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M15 3v18" />
        {open ? <rect width="6" height="18" x="15" y="3" fill="currentColor" stroke="none" /> : null}
    </svg>
)
