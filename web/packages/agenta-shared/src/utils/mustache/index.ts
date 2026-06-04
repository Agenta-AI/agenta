/**
 * Mustache parsing utilities.
 *
 * Exports a hand-rolled Mustache parser that produces a structural AST.
 * Used by variable discovery (`extractTemplateVariables`), schema inference
 * (sections → array-of-objects), and editor validation decorations
 * (unbalanced sections).
 *
 * Authority: `docs/designs/mustache-section-support.md` Phase 2.
 */

export {parseMustache, walkMustache} from "./parser"
export type {
    MustacheNode,
    TextNode,
    VariableNode,
    SectionNode,
    CommentNode,
    PartialNode,
    BlockNode,
    ParentNode,
    DelimiterNode,
    ParseError,
    ParseErrorKind,
    ParseResult,
    SourceSpan,
} from "./parser"
