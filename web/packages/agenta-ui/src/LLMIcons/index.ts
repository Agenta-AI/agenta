/**
 * @module LLMIcons
 *
 * SVG icons for LLM providers (OpenAI, Anthropic, Google, etc.)
 *
 * @example Usage
 * ```tsx
 * import {LLMIconMap} from '@agenta/entities/ui'
 *
 * const Icon = LLMIconMap['OpenAI']
 * if (Icon) return <Icon className="w-4 h-4" />
 * ```
 */

import AlephAlpha from "./assets/AlephAlpha"
import Anthropic from "./assets/Anthropic"
import AnyScale from "./assets/AnyScale"
import Azure from "./assets/Azure"
import Bedrock from "./assets/Bedrock"
import Cerebus from "./assets/Cerebus"
import DeepInfra from "./assets/DeepInfra"
import Fireworks from "./assets/Fireworks"
import Gemini from "./assets/Gemini"
import Groq from "./assets/Groq"
import Lepton from "./assets/Lepton"
import Mistral from "./assets/Mistral"
import OpenAi from "./assets/OpenAi"
import OpenRouter from "./assets/OpenRouter"
import Perplexity from "./assets/Perplexity"
import Replicate from "./assets/Replicate"
import Sagemaker from "./assets/Sagemaker"
import Together from "./assets/Together"
import Vertex from "./assets/Vertex"
import XAI from "./assets/XAI"

export type {IconProps} from "./assets/types"

/**
 * Map of provider names to their icon components.
 * Use this to look up icons by provider name.
 */
export const LLMIconMap: Record<string, React.FC<{className?: string}>> = {
    OpenAI: OpenAi,
    Cohere: Cerebus,
    Anyscale: AnyScale,
    DeepInfra: DeepInfra,
    "Aleph Alpha": AlephAlpha,
    Groq: Groq,
    "Mistral AI": Mistral,
    Anthropic: Anthropic,
    "Perplexity AI": Perplexity,
    "Together AI": Together,
    OpenRouter: OpenRouter,
    "Google Gemini": Gemini,
    "Google Vertex AI": Vertex,
    "AWS Bedrock": Bedrock,
    "AWS SageMaker": Sagemaker,
    "Azure OpenAI": Azure,
    Fireworks: Fireworks,
    Lepton: Lepton,
    Replicate: Replicate,
    xAI: XAI,
}

// Export individual icons for direct use
export {
    AlephAlpha,
    Anthropic,
    AnyScale,
    Azure,
    Bedrock,
    Cerebus,
    DeepInfra,
    Fireworks,
    Gemini,
    Groq,
    Lepton,
    Mistral,
    OpenAi,
    OpenRouter,
    Perplexity,
    Replicate,
    Sagemaker,
    Together,
    Vertex,
    XAI,
}

export default LLMIconMap
