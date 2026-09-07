# Provider subscription policy

> AGENT-GENERATED, low weight. This is a draft, not legal advice. Provider terms change and require
> review before release. Mahmoud must approve every enabled product.

Reviewed September 4, 2026. The unit of approval must be the provider product and access method,
not the provider name alone.

> Founder update, 2026-09-04: Mahmoud reports written confirmation from every provider below
> except Google Gemini and Anthropic that hosted Agenta Cloud use is acceptable when each user
> connects and spends their own contract. This founder-provided fact outranks the public-terms
> reading in the table. The table's public evidence is kept as the underlying record. Where a
> confirmation sets a per-product limit (for example unattended-schedule restrictions for Qwen or
> Z.AI), that limit must be encoded in usage-mode policy. Gemini and Anthropic OAuth stay blocked.

| Product and access method | Public evidence | Candidate Agenta posture |
| --- | --- | --- |
| MiniMax Token Plan API key or OAuth | MiniMax explicitly supports OpenClaw, third-party tools, agent use, and several concurrent agents. It recommends pay-as-you-go for production. | Best subscription candidate. Confirm whether hosted Agenta counts as a designated workflow before launch. |
| Kimi Code membership API key | Kimi explicitly supports third-party coding tools, self-built applications, OpenClaw, and Hermes. It requires the real client identity. | Good candidate for coding and approved agent use. Preserve the Agenta client identity and provider-required headers. Confirm unattended schedules. |
| GitHub Copilot through official Copilot CLI | GitHub documents device login, remote terminals, containers, and non-interactive environments. The CLI license permits unmodified redistribution inside a larger service. Subscription use still follows Copilot terms and one licensed user. | Promising. Use the official CLI unchanged. Require one licensed user per connection. Get written confirmation for multi-user-triggered hosted automation. |
| ChatGPT through Codex | OpenAI supports Codex device authorization. Mahmoud reports written approval for the Agenta Cloud model where each user spends their own contract. | Hosted candidate. Keep each connection private to its user and run the official Codex client. |
| Claude Pro or Max through Claude Code OAuth | Anthropic says subscriptions are for native Anthropic applications and recommends API keys for third-party tools. | Do not offer as a hosted subscription. Keep API and cloud credentials. Reassess only with written approval. |
| Gemini Code Assist or Google AI Pro OAuth | Google's Gemini CLI documentation explicitly says using Gemini CLI OAuth through third-party software such as OpenClaw violates its terms. | Block this authentication mode. Offer Gemini API keys or Vertex AI instead. |
| Z.AI GLM Coding Plan key | Z.AI lists OpenClaw as supported, but its subscription terms prohibit SaaS, bots, general application backends, and third-party provision without a separate agreement. | Self-hosted interactive use only, or obtain a written agreement. Do not enable hosted schedules by default. |
| Alibaba Qwen Coding Plan key | Alibaba allows interactive coding tools including OpenClaw but prohibits automated scripts, application backends, and non-interactive batch use. | Self-hosted interactive use only. Use normal Model Studio API billing for hosted agents and schedules. |
| SuperGrok subscription through Grok Build | SpaceXAI documents browser and device-code login for subscription use in third-party coding clients. Mahmoud also reports written approval for Agenta Cloud when each user spends their own contract. | Hosted candidate. Run the official Grok client and keep each connection private to its user. |
| OpenRouter API key | Designed as a metered API balance rather than consumer subscription reuse. | Supported through the normal vault connection path. |

## Primary sources

- Google Gemini CLI terms: https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md
- GitHub Copilot CLI authentication: https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli
- GitHub Copilot CLI license: https://github.com/github/copilot-cli/blob/main/LICENSE.md
- MiniMax OpenClaw guide: https://platform.minimax.io/docs/token-plan/openclaw
- MiniMax Token Plan: https://platform.minimax.io/subscribe/token-plan
- Kimi Code membership: https://www.kimi.com/en/help/kimi-code/membership-guide
- Z.AI subscription terms: https://docs.z.ai/legal-agreement/subscription-terms
- Z.AI OpenClaw guide: https://docs.z.ai/devpack/tool/openclaw
- Alibaba Qwen Coding Plan: https://help.aliyun.com/en/model-studio/coding-plan
- Anthropic login guidance: https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account
- OpenAI terms: https://openai.com/policies/terms-of-use/
- OpenAI Codex sign-in: https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt
- SpaceXAI consumer terms: https://x.ai/legal/terms-of-service
- SpaceXAI enterprise terms: https://x.ai/legal/terms-of-service-enterprise
