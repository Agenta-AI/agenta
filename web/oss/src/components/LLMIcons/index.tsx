import {SecretDTOProvider} from "@/oss/lib/Types"

import Anthropic from "./assets/Anthropic"
import Cerebus from "./assets/Cerebus"
import Fireworks from "./assets/Fireworks"
import Gemini from "./assets/Gemini"
import Groq from "./assets/Groq"
import Lepton from "./assets/Lepton"
import Mistral from "./assets/Mistral"
import OpenAi from "./assets/OpenAi"
import Perplexity from "./assets/Perplexity"
import Replicate from "./assets/Replicate"
import Together from "./assets/Together"
import XAI from "./assets/XAI"
import AlephAlpha from "./assets/AlephAlpha"
import AnyScale from "./assets/AnyScale"
import Azure from "./assets/Azure"
import Bedrock from "./assets/Bedrock"
import DeepInfra from "./assets/DeepInfra"
import OpenRouter from "./assets/OpenRouter"
import Sagemaker from "./assets/Sagemaker"
import Vertex from "./assets/Vertex"

const IconMap: Record<string, React.FC<{className?: string}>> = {
    [SecretDTOProvider.OPENAI]: OpenAi,
    [SecretDTOProvider.MISTRALAI]: Mistral,
    [SecretDTOProvider.COHERE]: Cerebus,
    [SecretDTOProvider.ANTHROPIC]: Anthropic,
    [SecretDTOProvider.PERPLEXITYAI]: Perplexity,
    [SecretDTOProvider.TOGETHERAI]: Together,
    [SecretDTOProvider.GROQ]: Groq,
    [SecretDTOProvider.GEMINI]: Gemini,
    [SecretDTOProvider.OPENROUTER]: OpenRouter,
    replicate: Replicate,
    lepton: Lepton,
    xai: XAI,
    fireworks: Fireworks,
    alephalpha: AlephAlpha,
    anyscale: AnyScale,
    azure: Azure,
    bedrock: Bedrock,
    deepinfra: DeepInfra,
    sagemaker: Sagemaker,
    vertex: Vertex,
}

export default IconMap
