# Research: Tool Integration Platforms for LLM Applications

## Executive Summary

This research evaluates tool integration platforms that provide pre-built integrations with OAuth handling and per-user credential management for LLM applications. The goal is to enable Agenta's agents to execute real-world actions (send emails, create calendar events, etc.) on behalf of users.

**Key Findings:**
- **Composio** is the most mature solution with 800+ toolkits, excellent OAuth handling, and is open source (MIT license) with 26.5k GitHub stars
- **Arcade AI** is a strong alternative focused on MCP (Model Context Protocol) with enterprise-grade auth
- **Zapier NLA** has been deprecated - their API endpoints return 404
- **Building from scratch** would require significant effort (OAuth flows, token refresh, per-user credential storage)
- **Self-hosting Composio** is possible but requires running their backend infrastructure

---

## 1. Composio Deep Dive

### Overview
Composio is the leading tool integration platform for AI agents with 26.5k GitHub stars and MIT license. It provides 800+ pre-built toolkits with automatic OAuth handling and credential management.

**Website:** https://composio.dev  
**GitHub:** https://github.com/composioHQ/composio  
**Docs:** https://docs.composio.dev

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Your Agent    │────▶│   Composio SDK  │────▶│  Composio API   │
│   (Agenta)      │     │   (Python/TS)   │     │  (Hosted/Self)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                        ┌───────────────────────────────┤
                        ▼                               ▼
                ┌───────────────┐             ┌───────────────┐
                │  OAuth Flows  │             │ Tool Execution│
                │  Token Mgmt   │             │ (Gmail, Slack)│
                └───────────────┘             └───────────────┘
```

**Key Components:**
1. **Sessions**: Per-user context that tracks authenticated connections
2. **Meta Tools**: 5 tools that discover, authenticate, and execute actions
3. **Toolkits**: Collections of tools for each service (GitHub, Gmail, etc.)
4. **Connected Accounts**: Per-user credential storage with automatic token refresh

### How Authentication Works

Composio uses **Connect Links** - hosted pages where users securely connect their accounts.

**Flow:**
1. Agent needs to access Gmail for a user
2. Composio generates a Connect Link: `https://connect.composio.dev/link/ln_abc123`
3. User clicks link, goes through OAuth consent
4. Composio stores tokens, handles refresh automatically
5. All future requests use stored credentials

**Auth Config Types:**
- **Composio Managed OAuth**: Default - uses Composio's registered OAuth apps
- **Custom OAuth Credentials**: Bring your own OAuth client ID/secret for white-labeling
- **API Keys**: User provides API key directly via Connect Link

### Code Examples

#### Python - Basic Setup with OpenAI

```python
from composio import Composio
from composio_openai import OpenAIProvider
from openai import OpenAI

# Initialize Composio with OpenAI provider
composio = Composio(provider=OpenAIProvider())
openai_client = OpenAI()

# Create a session for a specific user
user_id = "user_123"  # Your internal user ID
session = composio.create(user_id=user_id)

# Get tools formatted for OpenAI function calling
tools = session.tools()

# Use with OpenAI
response = openai_client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Send an email to john@example.com"}],
    tools=tools,
    tool_choice="auto"
)

# Handle tool calls - Composio executes them automatically
if response.choices[0].message.tool_calls:
    for tool_call in response.choices[0].message.tool_calls:
        result = session.execute(
            tool_call.function.name,
            tool_call.function.arguments
        )
```

#### Python - Manual Authentication Flow

```python
from composio import Composio

composio = Composio()

# Create session for user
user_id = "user_123"
session = composio.create(user_id=user_id)

# Generate auth link for a specific toolkit
auth_response = session.authorize(
    toolkit="gmail",
    scopes=["gmail.readonly", "gmail.send"]
)

if auth_response.status != "completed":
    # Send this URL to your user
    print(f"Please authorize: {auth_response.url}")
    
    # Wait for user to complete auth (or poll)
    auth_response = session.wait_for_completion(auth_response)

# Now user is connected, tools will work
tools = session.tools(toolkits=["gmail"])
```

#### TypeScript - Full Example

```typescript
import { Composio } from "@composio/core";
import { OpenAIProvider } from "@composio/openai";
import OpenAI from "openai";

const composio = new Composio({ provider: new OpenAIProvider() });
const openai = new OpenAI();

async function sendEmailForUser(userId: string, prompt: string) {
  // Create session for this user
  const session = await composio.create(userId);
  
  // Get OpenAI-formatted tools
  const tools = await session.tools({ toolkits: ["GMAIL"] });
  
  // Check if user is connected
  const connections = await session.getConnections();
  if (!connections.find(c => c.toolkit === "gmail")) {
    // Generate auth URL
    const authUrl = await session.authorize({ toolkit: "gmail" });
    return { needsAuth: true, authUrl };
  }
  
  // User is connected - proceed with LLM call
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
    tools,
    tool_choice: "auto"
  });
  
  // Execute tool calls
  for (const toolCall of response.choices[0].message.tool_calls || []) {
    const result = await session.execute(
      toolCall.function.name,
      JSON.parse(toolCall.function.arguments)
    );
    console.log("Tool result:", result);
  }
  
  return response;
}
```

### Pricing

| Tier | Price | Tool Calls | Connected Accounts |
|------|-------|------------|-------------------|
| Free | $0/mo | 20K/mo | 1K |
| Starter | $29/mo | 200K/mo (+$0.299/1K extra) | 30K (+$2/1K) |
| Business | $229/mo | 2M/mo (+$0.249/1K extra) | 100K (+$1/1K) |
| Enterprise | Custom | Custom | Custom + VPC/On-prem |

**Premium Tool Calls** (3x cost): Search APIs, code execution, web scraping, AI inference

### Self-Hosting Options

Composio is **open source (MIT)** and can be self-hosted:

```bash
# Clone and run with Docker
git clone https://github.com/ComposioHQ/composio.git
cd composio/docker
docker compose up
```

**Self-hosting considerations:**
- You need to register your own OAuth apps with each provider
- Handle your own secrets management
- No premium tools (search, code execution) unless you add those services
- Enterprise tier includes VPC/on-prem deployment support

---

## 2. Alternatives Comparison

### Arcade AI

**Website:** https://arcade.dev  
**GitHub:** https://github.com/ArcadeAI/arcade-mcp (MIT license, 794 stars)

**What it is:** MCP runtime for secure tool execution with agent auth. Focuses on enterprise-grade authentication and MCP protocol.

**Architecture:**
- Provides SDK for creating MCP servers
- Agent Auth system for OAuth with granular permissions
- Pre-built connectors for major services
- Tool evaluations for benchmarking LLM-tool interactions

**Code Example:**
```python
from arcadepy import Arcade

client = Arcade()
user_id = "user@example.com"

# Start OAuth flow
auth_response = client.auth.start(
    user_id, "google", 
    scopes=["https://www.googleapis.com/auth/gmail.readonly"]
)

if auth_response.status != "completed":
    print(f"Auth URL: {auth_response.url}")
    auth_response = client.auth.wait_for_completion(auth_response)

# Use the token
token = auth_response.context.token
```

**Pricing:** Not publicly listed - contact for enterprise pricing

**Pros:**
- MCP-native (good for Claude, Cursor integration)
- Strong focus on security and auth
- Self-hostable (Docker, K8s, macOS, Linux)

**Cons:**
- Smaller ecosystem than Composio
- Less mature (794 vs 26.5k stars)
- Pricing not transparent

### Toolhouse.ai

**Website:** https://toolhouse.ai

**What it is:** AI agent builder platform with built-in tools

**Key Points:**
- More focused on no-code agent building than developer SDK
- Pricing: Free (50 runs/mo), Pro ($20/mo for 2,500 runs)
- **Not open source**
- Less suitable for backend integration - more of a consumer product

**Verdict:** Not a good fit for Agenta - designed for end-users building agents, not for embedding in platforms

### Zapier NLA (Natural Language Actions)

**Status:** **DEPRECATED** - API endpoints return 404

Zapier has moved away from their NLA API. Their current offering is focused on their AI Actions product which is tightly integrated with their automation platform and not designed for third-party LLM platforms.

### GPTScript

**Website:** https://gptscript.ai  
**GitHub:** https://github.com/gptscript-ai/gptscript (Apache 2.0, 3.3k stars)

**What it is:** Framework for LLMs to interact with systems via natural language scripts

**Key Points:**
- More of an agent framework than a tool integration platform
- Written in Go, provides CLI tool
- Doesn't handle OAuth/credential management
- Better for local automation than multi-user SaaS

**Verdict:** Different category - not suitable for multi-tenant tool integrations

### Naptha SDK

**Website:** https://naptha.ai  
**GitHub:** https://github.com/NapthaAI/naptha-sdk (180 stars)

**What it is:** Framework for multi-agent systems with tools, knowledge bases, and memories

**Key Points:**
- Focus on multi-agent orchestration
- Knowledge base and memory management
- Less mature for pure tool integrations
- No built-in OAuth management

**Verdict:** Interesting for agent orchestration but not solving the tool/auth problem

---

## 3. Comparison Matrix

| Criteria | Composio | Arcade AI | Toolhouse | Custom Build |
|----------|----------|-----------|-----------|--------------|
| **Pre-built Integrations** | 800+ | 50+ | 30+ | 0 |
| **OAuth Handling** | Excellent | Good | Basic | Must build |
| **Per-user Credentials** | Yes | Yes | Yes | Must build |
| **OpenAI Integration** | Native | Yes | Limited | Manual |
| **Open Source** | Yes (MIT) | Yes (MIT) | No | N/A |
| **Self-Hostable** | Yes | Yes | No | Yes |
| **GitHub Stars** | 26.5k | 794 | N/A | N/A |
| **Pricing (Starter)** | $29/mo | Contact | $20/mo | Dev time |
| **MCP Support** | Yes | Native | No | Must build |
| **Documentation** | Excellent | Good | Basic | N/A |
| **SDK Languages** | Python, TS | Python, TS | N/A | Any |

---

## 4. Build vs Buy Analysis

### What Building In-House Requires

1. **OAuth Flow Implementation** (per provider)
   - Register OAuth apps with Google, GitHub, Slack, etc.
   - Implement authorization code flow
   - Handle token exchange and refresh
   - Estimated: 2-3 days per integration

2. **Credential Storage**
   - Secure token storage with encryption
   - Per-user token management
   - Token refresh job/daemon
   - Estimated: 1-2 weeks

3. **Tool Definitions**
   - Create JSON schemas for each tool
   - Implement API wrappers
   - Handle error cases, rate limits
   - Estimated: 1-2 days per tool

4. **Maintenance**
   - API changes from providers
   - OAuth scope changes
   - Token format changes
   - Estimated: Ongoing burden

**Total Initial Build:** 2-4 months for 10-20 integrations  
**Ongoing Maintenance:** 0.5-1 FTE

### Using Composio

**Initial Integration:** 1-2 weeks
- Add SDK dependency
- Implement session creation per user
- Add auth flow to UI
- Connect tool execution to LLM output

**Ongoing Costs:**
- $29-229/month for SaaS
- Or self-host with infrastructure costs

### Recommendation

**Use Composio** for Agenta because:

1. **Time to Market:** 10x faster than building in-house
2. **Open Source:** MIT license, can self-host if needed
3. **Proven at Scale:** 26.5k stars, 128+ enterprise customers
4. **Framework Support:** Native OpenAI, Anthropic, LangChain integration
5. **Cost Effective:** $29/mo covers 200K tool calls - plenty for MVP
6. **Exit Strategy:** Self-host option if SaaS becomes too expensive

---

## 5. Implementation Recommendations for Agenta

### Phase 1: MVP Integration

1. **Add Composio as a provider option** in agent configurations
2. **Per-workspace sessions** - each Agenta workspace gets a Composio user ID
3. **Auth UI component** - embed Connect Links in Agenta UI when tools need auth
4. **Tool discovery** - let users search/select from Composio's toolkit catalog

### Phase 2: Enhanced Integration

1. **Custom OAuth apps** - allow enterprise customers to use their own OAuth credentials
2. **Tool execution logging** - track tool calls in Agenta's observability
3. **Caching** - cache tool schemas to reduce latency
4. **Self-hosting option** - for enterprise customers with data residency requirements

### Architecture Sketch

```
┌─────────────────────────────────────────────────────────┐
│                     Agenta Platform                       │
├─────────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────────────┐   │
│  │ Playground│  │   SDK     │  │ Agent Runner      │   │
│  │    UI     │  │  (Python) │  │ (Tool Execution)  │   │
│  └─────┬─────┘  └─────┬─────┘  └─────────┬─────────┘   │
│        │              │                  │              │
│        ▼              ▼                  ▼              │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Tool Integration Layer                │   │
│  │  - Session management per workspace              │   │
│  │  - Auth URL generation                          │   │
│  │  - Tool schema caching                          │   │
│  └─────────────────────┬───────────────────────────┘   │
└────────────────────────┼───────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   Composio API      │
              │   (SaaS or Self)    │
              └─────────────────────┘
```

### Code: Integration Pattern for Agenta

```python
# agenta/services/tool_service.py
from composio import Composio
from typing import Optional, List, Dict, Any

class ToolService:
    """Service for managing tool integrations via Composio"""
    
    def __init__(self, api_key: str):
        self.composio = Composio(api_key=api_key)
    
    def get_session(self, workspace_id: str) -> ComposioSession:
        """Get or create a Composio session for a workspace"""
        return self.composio.create(user_id=f"agenta-workspace-{workspace_id}")
    
    async def get_tools_for_agent(
        self,
        workspace_id: str,
        toolkits: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Get OpenAI-formatted tools for an agent"""
        session = self.get_session(workspace_id)
        return await session.tools(toolkits=toolkits)
    
    async def get_auth_url(
        self,
        workspace_id: str,
        toolkit: str,
        scopes: Optional[List[str]] = None
    ) -> str:
        """Generate an auth URL for a user to connect a service"""
        session = self.get_session(workspace_id)
        auth = await session.authorize(toolkit=toolkit, scopes=scopes)
        return auth.url
    
    async def execute_tool(
        self,
        workspace_id: str,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute a tool and return the result"""
        session = self.get_session(workspace_id)
        return await session.execute(tool_name, arguments)
    
    async def list_connections(
        self,
        workspace_id: str
    ) -> List[Dict[str, Any]]:
        """List all connected services for a workspace"""
        session = self.get_session(workspace_id)
        return await session.get_connections()
```

---

## 6. Security Considerations

### Composio Security Model

1. **Credentials stored by Composio** - tokens never touch your servers (in SaaS mode)
2. **Automatic token refresh** - reduces token exposure window
3. **Scoped access** - request only needed OAuth scopes
4. **SOC-2 compliant** (Enterprise tier)
5. **Audit logs** (Business+ tiers)

### Self-Hosting Security

If self-hosting:
- Encrypt tokens at rest
- Use secrets manager (Vault, AWS Secrets Manager)
- Implement RBAC for multi-tenant isolation
- Regular security audits of credential storage

### Agenta-Specific Considerations

1. **Workspace isolation** - ensure tools from one workspace can't access another's credentials
2. **User consent** - always show which permissions will be granted before OAuth
3. **Revocation UI** - let users disconnect services easily
4. **Audit trail** - log which tools were called, by whom, with what data

---

## 7. Conclusion

**Primary Recommendation:** Integrate Composio as the tool integration layer for Agenta.

**Rationale:**
- Fastest path to production with 800+ pre-built integrations
- Open source with self-hosting option for enterprises
- Native support for OpenAI function calling format
- Automatic OAuth and credential management
- Proven at scale with enterprise customers

**Alternative:** Arcade AI could be considered if MCP-native architecture becomes critical, but Composio's larger ecosystem and more mature documentation make it the safer choice for initial integration.

**Not Recommended:**
- Toolhouse (consumer-focused, not embeddable)
- Zapier NLA (deprecated)
- Custom build (too much effort vs benefit)
