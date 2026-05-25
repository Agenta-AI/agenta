/**
 * `@agenta/entity-ui/template-format` — picker + options helper for the
 * prompt template_format choice (Mustache / Jinja2 / [Curly] / [F-string]).
 *
 *   import {TemplateFormatPicker, buildTemplateFormatOptions} from "@agenta/entity-ui/template-format"
 *
 * Vendored from #4393 (WP-B3 frontend slice) for this branch. See
 * `templateFormatOptions.ts` for the vendoring note: when #4393 merges,
 * this whole subpath gets diffed against its version and one of them gets
 * deleted.
 */

export {TemplateFormatPicker, type TemplateFormatPickerProps} from "./TemplateFormatPicker"

export {
    buildTemplateFormatOptions,
    DEFAULT_TEMPLATE_FORMAT,
    OFFERED_TEMPLATE_FORMATS,
    LEGACY_TEMPLATE_FORMATS,
    ALL_TEMPLATE_FORMATS,
    type TemplateFormatOption,
    type TemplateFormatValue,
} from "./templateFormatOptions"
