import {type EditorThemeClasses} from "lexical"

/**
 * Self-contained theme on the shadcn tokens (dark mode comes from the CSS variables). bold/italic
 * need explicit classes or Lexical renders the format unstyled.
 *
 * Kept in lock-step with the transcript prose (`proseClassName` in web/mobile
 * features/chat/AssistantMarkdown.tsx) so a block looks the same while you type it and once sent.
 */
export const chatInputTheme: EditorThemeClasses = {
    paragraph: "m-0",
    heading: {
        h1: "mb-1 mt-3 text-base font-semibold tracking-tight first:mt-0",
        h2: "mb-1 mt-3 text-sm font-semibold tracking-tight first:mt-0",
        h3: "mb-1 mt-3 text-sm font-semibold tracking-tight first:mt-0",
    },
    link: "cursor-pointer break-all font-medium text-primary underline",
    code: "my-2 block overflow-x-auto whitespace-pre rounded-md border border-solid border-border/60 bg-muted px-3 py-2.5 font-mono text-xs leading-[18px]",
    quote: "mx-0 my-2 border-y-0 border-l-2 border-r-0 border-solid border-border/60 pl-3 text-left not-italic text-muted-foreground",
    list: {
        ul: "my-1 list-none p-0 [li>&]:border-0 [li>&]:border-l [li>&]:border-solid [li>&]:border-border/60 [li>&]:pl-3.5",
        ol: "my-1 list-outside list-decimal pl-5",
        // Our own 5px dot, hung in the indent; a nested list is a ruled block, not more dots.
        listitem:
            "my-0.5 [ol>&]:marker:text-muted-foreground [ul>&]:relative [ul>&]:pl-4 [ul>&]:before:absolute [ul>&]:before:left-0.5 [ul>&]:before:top-[calc(0.5lh_-_2.5px)] [ul>&]:before:size-[5px] [ul>&]:before:rounded-full [ul>&]:before:bg-foreground [li>ul>&]:pl-0 [li>ul>&]:before:hidden",
        nested: {
            // The li wrapping a nested list keeps the indent, so its rule sits under the text.
            listitem: "list-none [ul>&]:before:hidden",
        },
    },
    text: {
        bold: "font-semibold",
        italic: "italic",
        code: "rounded bg-muted px-[5px] py-px font-mono text-[0.9em]",
    },
}
