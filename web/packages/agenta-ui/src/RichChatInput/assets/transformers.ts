import {
    BOLD_ITALIC_STAR,
    BOLD_ITALIC_UNDERSCORE,
    BOLD_STAR,
    BOLD_UNDERSCORE,
    CODE,
    INLINE_CODE,
    ITALIC_STAR,
    ITALIC_UNDERSCORE,
    ORDERED_LIST,
    QUOTE,
    UNORDERED_LIST,
    type Transformer,
} from "@lexical/markdown"

/**
 * Curated markdown transformer set for the chat composer. Drives BOTH live
 * typing (e.g. `- ` → bullet list, ` ``` ` → code block) and serialization on
 * send, so what the user types round-trips to markdown cleanly. Deliberately
 * omits headings, checklists, links and tables to keep a chat message light.
 */
export const CHAT_TRANSFORMERS: Transformer[] = [
    UNORDERED_LIST,
    ORDERED_LIST,
    QUOTE,
    CODE,
    INLINE_CODE,
    // Bold+italic combos must precede the single-format variants so `***x***`
    // matches before `**x**` / `*x*`.
    BOLD_ITALIC_STAR,
    BOLD_ITALIC_UNDERSCORE,
    BOLD_STAR,
    BOLD_UNDERSCORE,
    ITALIC_STAR,
    ITALIC_UNDERSCORE,
]
