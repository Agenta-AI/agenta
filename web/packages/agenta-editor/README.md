# @agenta/editor

The Lexical editors and the views built on them. It moved out of `@agenta/ui` so that the kit
does not carry the Lexical dependencies.

| Subpath | Folder | Key exports |
| --- | --- | --- |
| `@agenta/editor/editor` | `src/editor` | `Editor`, `EditorProvider`, `DiffView`, `MarkdownPreview`, JSON parsing utilities |
| `@agenta/editor/shared-editor` | `src/shared-editor` | `SharedEditor`, `useDebounceInput` |
| `@agenta/editor/rich-chat-input` | `src/rich-chat-input` | `RichChatInput`, the slash and file palettes |
| `@agenta/editor/chat-message` | `src/chat-message` | `ChatMessageEditor`, `ChatMessageList` |
| `@agenta/editor/quote-selection` | `src/quote-selection` | Quote a selection and leave a note on it |
| `@agenta/editor/drill-in` | `src/drill-in` | The drill-in field views (`DrillInContent`, the field renderers) |
| `@agenta/editor/diff` | `src/editor/utils/diffUtils.ts` | `computeTextDiffLines` and the diff types (no Lexical) |
| `@agenta/editor/editor-theme.css` | `src/styles` | The editor theme |
| `@agenta/editor/code-editor-styles.css` | `src/styles` | Prism code tokens |

`@agenta/editor` imports `@agenta/ui` through its public subpaths (`@agenta/ui/ui`,
`@agenta/ui/composed`, ...). `@agenta/ui` never imports `@agenta/editor`.

The drill-in views are here, and not in `@agenta/ui`, because they render the editors and the
chat message list renders them.

```bash
pnpm --filter @agenta/editor types:check
pnpm --filter @agenta/editor lint
pnpm --filter @agenta/editor test:unit
```
