// @ts-ignore
import type {StateVariant} from "../state/types"
import type {
    AgentaConfig,
    AgentaPromptSchema,
    Message,
    LLMConfig,
    TemplateFormat,
    LLMConfigSchema,
    PromptConfigType,
    MessageSchema,
} from "../types/parsedSchema"
import type {
    ArraySchema,
    StringSchema,
    EnumSchema,
    Nullable,
    SchemaObject,
    // MessageSchema,
    // PromptConfigType
} from "../types/shared"

interface RequestBody {
    agenta_config: AgentaConfig
    inputs: Record<string, unknown>
}

// function isPromptConfig(value: unknown): value is PromptConfigType {
//     return typeof value === "object" && value !== null && "value" in value
// }

// function createMessagesSchema(config: SchemaObject): ArraySchema<MessageSchema> {
//     return {
//         type: "array",
//         items: {
//             type: "object",
//             properties: {
//                 role: {
//                     type: "string",
//                     enum: ["system", "user", "assistant", "tool", "function"],
//                 },
//                 content: {type: "string"},
//                 name: {type: "string"},
//                 tool_calls: {
//                     type: "array",
//                     items: {
//                         type: "object",
//                         properties: {
//                             id: {type: "string"},
//                             type: {
//                                 type: "string",
//                                 const: "function",
//                                 default: "function",
//                             },
//                             function: {
//                                 type: "object",
//                                 additionalProperties: {type: "string"},
//                             },
//                         },
//                         required: ["id", "function"],
//                     },
//                 },
//                 tool_call_id: {type: "string"},
//             },
//             required: ["role"],
//         },
//         title: "Messages",
//     }
// }

// function createStringSchema(title: string): Nullable<StringSchema> {
//     return {
//         type: "string",
//         title,
//         anyOf: [{type: "string"}, {type: "null"}],
//     }
// }

// function createTemplateFormatSchema(): EnumSchema<TemplateFormat> {
//     return {
//         type: "string",
//         enum: ["fstring", "jinja2", "curly"],
//         title: "Template Format",
//         description:
//             "Format type for template variables: fstring {var}, jinja2 {{ var }}, or curly {{var}}",
//         default: "fstring",
//     }
// }

// improve this
// function createLLMConfigSchema(config: SchemaObject): LLMConfigSchema {
//     return {
//         type: "object",
//         title: "ModelConfig",
//         properties: {
//             model: {
//                 type: "string",
//                 title: "Model",
//                 description: "ID of the model to use",
//                 default: "gpt-3.5-turbo",
//             },
//             temperature: {
//                 type: "number",
//                 title: "Temperature",
//                 description: "What sampling temperature to use, between 0 and 2",
//                 minimum: 0,
//                 maximum: 2,
//             },
//             max_tokens: {
//                 type: "number",
//                 title: "Max Tokens",
//                 description: "The maximum number of tokens that can be generated",
//             },
//             top_p: {
//                 type: "number",
//                 title: "Top P",
//                 description: "Alternative to sampling with temperature",
//                 minimum: 0,
//                 maximum: 1,
//             },
//             frequency_penalty: {
//                 type: "number",
//                 title: "Frequency Penalty",
//                 description: "Number between -2.0 and 2.0",
//                 minimum: -2,
//                 maximum: 2,
//             },
//             presence_penalty: {
//                 type: "number",
//                 title: "Presence Penalty",
//                 description: "Number between -2.0 and 2.0",
//                 minimum: -2,
//                 maximum: 2,
//             },
//             response_format: {
//                 type: "object",
//                 title: "Response Format",
//                 description: "Specifies the format that the model must output",
//                 properties: {
//                     type: {
//                         type: "string",
//                         enum: ["text", "json_object", "json_schema"],
//                     },
//                 },
//             },
//             stream: {
//                 type: "boolean",
//                 title: "Stream",
//                 description: "If set, partial message deltas will be sent",
//             },
//             tools: {
//                 type: "array",
//                 items: {type: "object"},
//                 title: "Tools",
//             },
//             tool_choice: {
//                 type: "string",
//                 enum: ["none", "auto"],
//                 title: "Tool Choice",
//                 description: "Controls which tool is called by the model",
//             },
//         },
//     }
// }

// function transformPromptConfigToAgentaConfig(variant: StateVariant): AgentaConfig {
//     if (!variant.schema) {
//         throw new Error("Variant schema is required")
//     }

//     const promptConfig = variant.schema.promptConfig[0]
//     if (!promptConfig) {
//         throw new Error("Prompt configuration is required")
//     }

//     // Extract values ensuring type safety by checking if they're PromptConfigType
//     const messages = isPromptConfig(promptConfig.messages) ? promptConfig.messages.value : []
//     const llmConfig = isPromptConfig(promptConfig.llm_config)
//         ? promptConfig.llm_config.value
//         : undefined
//     const systemPrompt = isPromptConfig(promptConfig.system_prompt)
//         ? promptConfig.system_prompt.value
//         : undefined
//     const userPrompt = isPromptConfig(promptConfig.user_prompt)
//         ? promptConfig.user_prompt.value
//         : undefined
//     const templateFormat = isPromptConfig(promptConfig.template_format)
//         ? promptConfig.template_format.value
//         : undefined

//     const promptSchema: AgentaPromptSchema = {
//         type: "object",
//         title: "PromptTemplate",
//         description: "A template for generating prompts with formatting capabilities",
//         properties: {
//             messages: createMessagesSchema(promptConfig.messages.config),
//             system_prompt: createStringSchema("System Prompt"),
//             user_prompt: createStringSchema("User Prompt"),
//             template_format: createTemplateFormatSchema(),
//             llm_config: createLLMConfigSchema(promptConfig.llm_config.config),
//         },
//     }

//     return {
//         default: {
//             prompt: {
//                 llm_config: llmConfig || {model: "gpt-3.5-turbo"},
//                 messages: messages as Message[],
//                 system_prompt: systemPrompt || "",
//                 template_format: (templateFormat as TemplateFormat) || "fstring",
//                 user_prompt: userPrompt || "",
//             },
//         },
//         properties: {
//             prompt: promptSchema,
//         },
//         type: "object",
//         title: "MyConfig",
//     }
// }

// export function transformVariantToRequest(variant: StateVariant): RequestBody {
//     if (!variant.schema) {
//         throw new Error("Variant schema is required")
//     }

//     return {
//         agenta_config: transformPromptConfigToAgentaConfig(variant),
//         inputs: {}, // Default empty inputs
//     }
// }
