import {useTypewriter} from "@agenta/chat/hooks"

import Markdown from "../assets/markdown"

/**
 * Markdown whose text is revealed on the frame clock ({@link useTypewriter}) rather than in one
 * lump per commit. It lives here rather than beside `Markdown` because `_app.tsx` statically
 * imports that module to register the drive renderer — putting a `@agenta/chat/hooks` import
 * there would drag the whole hooks barrel into the app shell's graph.
 *
 * Owning the per-frame state in this leaf also keeps it out of `AgentMessage`, which regroups
 * every part on each render.
 *
 * `streaming` stays on until the reveal has drained, not until the stream ends — the visible text
 * is a truncated prefix, so healing must outlive the last delta or a half-written fence renders
 * raw for the last frames of every turn.
 */
const StreamingMarkdown = ({
    content,
    className,
    streaming = false,
    urgent = false,
}: {
    content: string
    className?: string
    /** The part is still receiving text. */
    streaming?: boolean
    /** The part is no longer last: finish fast so a tool card below never outruns its prose. */
    urgent?: boolean
}) => {
    const {text, settled} = useTypewriter(content, {urgent})
    return <Markdown content={text} className={className} streaming={streaming || !settled} />
}

export default StreamingMarkdown
