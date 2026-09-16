import {Copy} from "lucide-react"

/** The fence's copy control with a word beside the glyph (Streamdown's own is a bare icon). */
export const CopyLabelled = ({size = 14}: {size?: number}) => (
    <>
        <Copy size={size} aria-hidden />
        <span>Copy</span>
    </>
)
