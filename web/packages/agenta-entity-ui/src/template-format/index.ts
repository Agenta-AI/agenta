/**
 * `@agenta/entity-ui/template-format` — picker component for the prompt
 * template_format choice (Mustache / Jinja2 / [Curly] / [F-string]).
 *
 *   import {TemplateFormatPicker} from "@agenta/entity-ui/template-format"
 *
 * The options + labels live in WP-B3's
 * `agenta-entity-ui/src/DrillInView/SchemaControls/templateFormatOptions.ts`
 * (the same helper the drawer's PromptSchemaControl consumes). This subpath
 * exists as a clean home for the picker component used outside the drawer
 * (e.g. the playground); re-exports the helper for convenience.
 */

export {TemplateFormatPicker, type TemplateFormatPickerProps} from "./TemplateFormatPicker"

export {
    buildTemplateFormatOptions,
    OFFERED_TEMPLATE_FORMATS,
    TEMPLATE_FORMAT_LABELS,
    type TemplateFormat,
} from "../DrillInView/SchemaControls/templateFormatOptions"
