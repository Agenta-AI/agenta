import {type EditorThemeClasses} from "lexical"

/**
 * Self-contained theme using Tailwind utilities + antd semantic tokens (no `dark:` — dark mode is
 * handled by the CSS variables). bold/italic need explicit classes or Lexical renders the format
 * unstyled.
 *
 * Kept in lock-step with the message bubble's markdown styling (web/oss AgentChatSlice
 * assets/markdown.tsx `MD_CLASS`) — same tokens/values — so a block looks identical while you type
 * it and after it's sent. In particular the blockquote needs the left rule + secondary text + italic
 * (the italic is what visually distinguishes it from a paragraph); a subtle border alone reads as
 * plain text.
 */
export const chatInputTheme: EditorThemeClasses = {
    paragraph: "m-0",
    link: "text-colorPrimary underline break-all cursor-pointer",
    code: "my-1 block overflow-x-auto whitespace-pre rounded bg-colorFillTertiary p-2 font-mono text-[0.85em] leading-snug",
    quote: "my-1 mx-0 pl-3 text-left border-y-0 border-r-0 border-l-2 border-solid border-colorTextTertiary italic text-colorTextSecondary",
    list: {
        ul: "my-1 list-disc pl-5",
        ol: "my-1 list-decimal pl-5",
        listitem: "my-0.5",
        nested: {
            listitem: "list-none",
        },
    },
    text: {
        bold: "font-semibold",
        italic: "italic",
        code: "rounded bg-colorFillTertiary px-1 py-0.5 font-mono text-[0.85em]",
    },
}
