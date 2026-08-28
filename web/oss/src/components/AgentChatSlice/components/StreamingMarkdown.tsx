import {useTypewriter} from "@agenta/chat/hooks"

import Markdown from "../assets/markdown"

/**
 * Markdown revealed on the frame clock ({@link useTypewriter}) rather than one lump per commit.
 * Separate from `assets/markdown` because `_app.tsx` imports that module, so a `@agenta/chat/hooks`
 * import there would pull the hooks barrel into the app shell. `streaming` stays on until the
 * reveal drains: the visible text is a prefix, so healing must outlive the last delta.
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
