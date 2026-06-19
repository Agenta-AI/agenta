import {XMarkdown} from "@ant-design/x-markdown"

// Dark-mode-aware markdown styling (links/code/lists). `min-w-0` + `max-w-full` + the
// per-element width guards keep long lines / code blocks from widening their container;
// code blocks scroll within their own box instead.
export const MD_CLASS =
    "min-w-0 max-w-full overflow-hidden break-words text-sm leading-relaxed " +
    "[&_a]:text-colorPrimary [&_a]:underline [&_a]:break-all [&_p]:my-1 [&_p]:break-words " +
    "[&_ul]:my-1 [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:pl-5 [&_li]:my-0.5 [&_code]:rounded " +
    "[&_code]:bg-colorFillTertiary [&_code]:px-1 [&_code]:break-words [&_pre]:bg-colorFillTertiary " +
    "[&_pre]:p-2 [&_pre]:rounded [&_pre]:max-w-full [&_pre]:min-w-0 [&_pre]:overflow-x-auto"

/** Shared markdown renderer for the slice — used by message bubbles and the composer
 * live preview, so both render identically. */
const Markdown = ({content}: {content: string}) => (
    <XMarkdown className={MD_CLASS} content={content} />
)

export default Markdown
