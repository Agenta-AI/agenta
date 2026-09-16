import {Check} from "lucide-react"

/** The fence's copied state, said in a word: a 14px glyph changing shape is easy to miss. */
export const CopiedLabelled = ({size = 14}: {size?: number}) => (
    <>
        <Check size={size} aria-hidden />
        <span>Copied</span>
    </>
)
