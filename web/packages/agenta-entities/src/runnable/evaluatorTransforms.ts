/**
 * Evaluator Configuration Transforms
 *
 * Pure functions that transform between flat evaluator parameters (backend format)
 * and nested prompt structure (UI format).
 *
 * Evaluator workflows store flat configuration on the backend:
 *   { prompt_template, model, response_type, json_schema, correct_answer_key, threshold, ... }
 *
 * App workflows store nested configuration:
 *   { prompt: { messages, llm_config: { model } }, feedback_config: { type, json_schema }, ... }
 *
 * These transforms align evaluator data with app workflow data for consistent UI rendering
 * via PlaygroundConfigSection, which is entity-type-agnostic.
 *
 * @packageDocumentation
 */

// ============================================================================
// DETECTION
// ============================================================================

/**
 * Detect if the parameters are evaluator flat config that should be nested.
 * Flat evaluator configs have `prompt_template` + `model` at root, no `prompt`.
 */
export function isEvaluatorFlatParams(params: Record<string, unknown> | null | undefined): boolean {
    if (!params) return false
    return (
        !params.prompt && typeof params.model === "string" && Array.isArray(params.prompt_template)
    )
}

// ============================================================================
// CONFIGURATION TRANSFORMS
// ============================================================================

/**
 * Transform flat evaluator parameters to nested prompt structure.
 * Aligns evaluator config with app workflow config for consistent UI rendering.
 *
 * FROM: { prompt_template: [...], model: "...", response_type: "...", json_schema: {...}, correct_answer_key: "...", threshold: ..., version: "..." }
 * TO:   { prompt: { messages: [...], llm_config: { model: "..." } }, feedback_config: { type: "...", json_schema: {...} }, advanced_config: {...} }
 *
 * Also handles already-nested data by extracting feedback_config from prompt.llm_config.response_format.
 *
 * Hidden fields (not rendered): version, correct_answer_key, threshold
 * These are stored but not shown in the UI config section.
 */
export function nestEvaluatorConfiguration(
    flat: Record<string, unknown>,
    schema?: Record<string, unknown> | null,
): Record<string, unknown> {
    // Handle already-nested data: extract feedback_config from prompt.llm_config.response_format
    if (!isEvaluatorFlatParams(flat)) {
        // Check if data is already nested with prompt.llm_config.response_format
        const prompt = flat.prompt as Record<string, unknown> | undefined
        const llmConfig = (prompt?.llm_config ?? prompt?.llmConfig) as
            | Record<string, unknown>
            | undefined
        const responseFormat = llmConfig?.response_format as Record<string, unknown> | undefined

        // If response_format exists in llm_config, move it to top-level feedback_config
        if (responseFormat && !flat.feedback_config) {
            const {response_format: _rf, ...restLlmConfig} = llmConfig as Record<string, unknown>
            return {
                ...flat,
                prompt: {
                    ...prompt,
                    llm_config: restLlmConfig,
                },
                feedback_config: responseFormat,
            }
        }

        // Non-LLM evaluator: group x-advanced fields under advanced_settings
        // to match the schema transform from nestEvaluatorSchema.
        const schemaProps = schema?.properties as
            | Record<string, Record<string, unknown>>
            | undefined
        if (schemaProps) {
            const advancedKeys = Object.entries(schemaProps)
                .filter(([, prop]) => prop["x-advanced"] === true)
                .map(([key]) => key)
            if (advancedKeys.length > 0) {
                const primaryData: Record<string, unknown> = {}
                const advancedData: Record<string, unknown> = {}
                for (const [key, value] of Object.entries(flat)) {
                    if (advancedKeys.includes(key)) {
                        advancedData[key] = value
                    } else {
                        primaryData[key] = value
                    }
                }
                return {...primaryData, advanced_settings: advancedData}
            }
        }

        return flat
    }

    const {
        prompt_template,
        model,
        response_type,
        json_schema,
        // Hidden fields - stored in __evaluator_meta for persistence but not rendered
        version: _version,
        correct_answer_key: _correctAnswerKey,
        threshold: _threshold,
        ...rest
    } = flat

    // Always include feedback_config — matches schema transform which always adds it.
    // For v3 evaluators without response_type, this creates an empty config that
    // FeedbackConfigurationControl can populate.
    const feedbackConfig: Record<string, unknown> = {
        type: response_type ?? "json_schema",
        ...(json_schema ? {json_schema} : {}),
    }

    const result = {
        prompt: {
            messages: prompt_template,
            llm_config: {
                model,
            },
        },
        // Feedback configuration as a top-level section (matches schema)
        feedback_config: feedbackConfig,
        // Store evaluator-specific fields in a named section
        advanced_config: {
            correct_answer_key: _correctAnswerKey,
            threshold: _threshold,
        },
        ...rest,
    }
    return result
}

/**
 * Reverse transform: nested prompt structure back to flat evaluator parameters.
 * Restores hidden fields from advanced_config and extracts feedback_config.
 */
export function flattenEvaluatorConfiguration(
    nested: Record<string, unknown>,
    originalFlat: Record<string, unknown> | null,
): Record<string, unknown> {
    // Non-LLM evaluator: unwrap advanced_settings back to flat
    if (nested.advanced_settings && !nested.prompt) {
        const {advanced_settings, ...rest} = nested
        const advancedData = advanced_settings as Record<string, unknown>
        return {...rest, ...advancedData}
    }

    const prompt = nested.prompt as Record<string, unknown> | undefined
    if (!prompt || !prompt.messages) return nested

    const llmConfig = (prompt.llm_config ?? prompt.llmConfig) as Record<string, unknown> | undefined

    // Extract feedback_config from top level (new structure)
    const feedbackConfig = nested.feedback_config as Record<string, unknown> | undefined

    // Extract advanced config fields or fall back to originalFlat
    const advancedConfig = nested.advanced_config as Record<string, unknown> | undefined

    // Start with original flat params to preserve all fields, then override with changes
    const result: Record<string, unknown> = {
        ...(originalFlat ?? {}),
        prompt_template: prompt.messages,
        model: llmConfig?.model ?? originalFlat?.model,
    }

    // Extract response_type and json_schema from feedback_config (if provided)
    if (feedbackConfig?.type !== undefined) {
        result.response_type = feedbackConfig.type
    }
    if (feedbackConfig?.json_schema !== undefined) {
        result.json_schema = feedbackConfig.json_schema
    }

    // Override advanced config fields if provided
    if (advancedConfig?.correct_answer_key !== undefined) {
        result.correct_answer_key = advancedConfig.correct_answer_key
    }
    if (advancedConfig?.threshold !== undefined) {
        result.threshold = advancedConfig.threshold
    }

    return result
}

// ============================================================================
// SCHEMA HELPERS
// ============================================================================

/**
 * Build a feedback_config schema entry for the UI.
 * Uses provided response_type/json_schema schema definitions when available,
 * otherwise falls back to generic string/object schemas.
 */
function buildFeedbackConfigSchema(
    responseTypeSchema?: unknown,
    jsonSchemaSchema?: unknown,
): Record<string, unknown> {
    return {
        type: "object",
        title: "Feedback Configuration",
        "x-parameter": "feedback_config",
        properties: {
            type: responseTypeSchema ?? {type: "string", title: "Response Type"},
            json_schema: jsonSchemaSchema ?? {type: "object", title: "JSON Schema"},
        },
    }
}

// ============================================================================
// NON-LLM EVALUATOR SCHEMA GROUPING
// ============================================================================

/**
 * Group non-LLM evaluator schema properties into primary fields and an
 * "Advanced Settings" collapsible section, matching the legacy evaluator form.
 *
 * Properties with `x-advanced: true` (set by template UI hints) are placed
 * under an "Advanced Settings" inline object. Remaining properties render
 * as top-level inline fields.
 */
function nestNonLlmEvaluatorSchema(
    flatSchema: Record<string, unknown>,
    properties: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
    const primaryProps: Record<string, Record<string, unknown>> = {}
    const advancedProps: Record<string, Record<string, unknown>> = {}

    for (const [key, prop] of Object.entries(properties)) {
        if (prop["x-advanced"] === true) {
            // Strip x-advanced from the prop since the grouping handles visibility
            const {["x-advanced"]: _, ...cleanProp} = prop
            advancedProps[key] = cleanProp
        } else {
            primaryProps[key] = prop
        }
    }

    const resultProperties: Record<string, unknown> = {...primaryProps}

    if (Object.keys(advancedProps).length > 0) {
        resultProperties.advanced_settings = {
            type: "object",
            title: "Advanced Settings",
            "x-parameter": "inline",
            properties: advancedProps,
        }
    }

    return {
        ...flatSchema,
        type: "object",
        properties: resultProperties,
    }
}

// ============================================================================
// SCHEMA TRANSFORMS
// ============================================================================

/**
 * Transform flat evaluator parameters schema to nested prompt structure.
 * Aligns evaluator schema with app workflow schema for consistent UI rendering.
 *
 * FROM schema: { properties: { prompt_template: {...}, model: {...}, response_type: {...}, json_schema: {...}, version: {...}, ... } }
 * TO schema:   { properties: { prompt: { properties: { messages: {...}, llm_config: { properties: { model: {...} } } } } } }
 *
 * Hidden fields (not in output schema): version, correct_answer_key, threshold
 */
export function nestEvaluatorSchema(flatSchema: Record<string, unknown>): Record<string, unknown> {
    const properties = flatSchema.properties as Record<string, Record<string, unknown>> | undefined
    if (!properties || !properties.prompt_template || !properties.model) {
        // Handle already-nested schema: the API may return a pre-nested schema without
        // feedback_config. Since nestEvaluatorConfiguration creates feedback_config from
        // response_type/json_schema data, we need a matching schema entry for the UI
        // to render FeedbackConfigurationControl instead of a generic drill-in.
        if (properties?.prompt && !properties.feedback_config) {
            return {
                ...flatSchema,
                type: "object",
                properties: {
                    ...properties,
                    feedback_config: buildFeedbackConfigSchema(),
                },
            }
        }

        // Non-LLM evaluators: group x-advanced fields under "Advanced Settings"
        // so the playground renders them in a collapsible section matching the
        // legacy evaluator form layout.
        if (properties) {
            return nestNonLlmEvaluatorSchema(flatSchema, properties)
        }

        return flatSchema
    }

    const {
        prompt_template,
        model,
        response_type,
        json_schema,
        // Hidden fields - excluded from top-level schema
        version: _version,
        correct_answer_key,
        threshold,
        ...restProps
    } = properties

    // Always include feedback_config schema — nestEvaluatorConfiguration creates
    // feedback_config data from response_type/json_schema fields regardless of whether
    // they appear in the schema (v3 evaluators have the data but not the schema fields).
    // Use x-parameter: "feedback_config" to trigger FeedbackConfigurationControl.
    const feedbackConfigSchema = buildFeedbackConfigSchema(response_type, json_schema)

    // Build advanced_config schema if any of the fields exist
    const hasAdvancedFields = correct_answer_key || threshold
    const advancedConfigSchema = hasAdvancedFields
        ? {
              type: "object",
              title: "Advanced Configuration",
              "x-parameter": "inline", // Render properties inline, not as drill-in
              properties: {
                  ...(correct_answer_key ? {correct_answer_key} : {}),
                  ...(threshold ? {threshold} : {}),
              },
          }
        : undefined

    const result = {
        ...flatSchema,
        type: "object",
        properties: {
            prompt: {
                type: "object",
                title: "Prompt",
                "x-parameter": "prompt",
                properties: {
                    messages: prompt_template,
                    llm_config: {
                        type: "object",
                        title: "LLM Config",
                        properties: {
                            model,
                        },
                    },
                },
            },
            // Feedback Configuration as a top-level collapsible section
            feedback_config: feedbackConfigSchema,
            ...(advancedConfigSchema ? {advanced_config: advancedConfigSchema} : {}),
            ...restProps,
        },
    }
    return result
}
