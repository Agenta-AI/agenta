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

const IconMap: Record<string, React.FC<{className?: string}>> = {
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
    // "AWS SageMaker": Sagemaker,
    "Azure OpenAI": Azure,
}

export default IconMap
