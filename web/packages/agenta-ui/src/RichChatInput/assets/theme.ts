import {type EditorThemeClasses} from "lexical"

/**
 * Self-contained theme using Tailwind utilities + antd semantic tokens (no
 * `dark:` — dark mode is handled by the CSS variables). bold/italic need
 * explicit classes or Lexical renders the format unstyled.
 */
export const chatInputTheme: EditorThemeClasses = {
    paragraph: "m-0",
    code: "my-1 block overflow-x-auto whitespace-pre rounded bg-[var(--ag-colorFillSecondary)] p-2 font-mono text-[0.85em] leading-snug",
    quote: "my-1 border-l-2 border-solid border-[var(--ag-colorBorder)] pl-3 text-[var(--ag-colorTextSecondary)]",
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
        code: "rounded bg-[var(--ag-colorFillSecondary)] px-1 py-0.5 font-mono text-[0.85em]",
    },
}
