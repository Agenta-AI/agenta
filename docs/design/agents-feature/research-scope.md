# Research: Feature Scope & PRD

## Objective

Define clear boundaries for the agents feature MVP.

## What is an "Agent" in Agenta Context?

> TODO: Define

### Spectrum of Capabilities

1. **Prompt with Tools** - Single LLM call with function calling
2. **ReAct Agent** - Thought-action-observation loop
3. **Multi-step Agent** - Planning and execution
4. **Multi-agent System** - Multiple agents collaborating

**Question:** Where on this spectrum does Agenta's MVP sit?

## Use Cases to Support

### Example Use Cases

Based on competitive analysis, the most common use cases are:

1. **Customer Support Bots** - Agents with access to knowledge bases and ability to escalate to humans
2. **Data Processing Agents** - Extract information from documents (PDFs, images), transform data
3. **Research Assistants** - Agents that can search the web, query databases, and synthesize information
4. **Content Generation** - Multi-agent workflows where specialized agents collaborate (research, write, edit)
5. **Tool-Augmented Assistants** - Agents that can call external APIs, execute code, query databases

### Anti-Use Cases (Out of Scope)

Based on competitive analysis, these are typically advanced/enterprise features:

- **Human-in-the-loop approval workflows** (Orq.ai has this "coming soon")
- **Multi-agent orchestration** (Vellum has this but it's complex)
- **Custom OAuth tool connections** (Composio integration pattern)
- **Long-running background agents** (async execution patterns)

## Feature Boundaries

### In Scope (MVP)

Based on competitive analysis, MVP should include:

1. **Tool/Function Definition in UI**
   - JSON Schema-based tool definitions (like Vellum, Orq.ai)
   - Upload JSON/YAML or define via form (Vellum pattern)
   - Built-in tools: current_date, web_scraper (Orq.ai pattern)

2. **Agent Configuration**
   - System prompt / instructions
   - Model selection
   - Max iterations limit
   - Max execution time limit

3. **Playground Testing**
   - Chat-based testing interface
   - View tool calls inline
   - Continue conversations (task continuation)

4. **Observability/Tracing**
   - Tool call visualization in traces
   - Agent reasoning steps (thought-action-observation)
   - Cost/latency per agent run

### Out of Scope (Future)

- Visual workflow builder (Vellum's main differentiator)
- Multi-agent orchestration
- Knowledge base integration
- Memory stores / persistent context
- Human approval workflows
- Background/async agent execution
- Third-party tool integrations (Composio, etc.)

## Competitive Analysis

### Platform Summaries

#### 1. Orq.ai
**Website:** https://orq.ai

**Agent Capabilities:**
- **Full Agent API** - Create agents programmatically with role, description, instructions, model configuration
- **Built on A2A Protocol** - Standardized agent-to-agent communication
- **Tool Types:**
  - Standard tools: `current_date`, `google_search`, `web_scraper`
  - Function tools: Custom functions with OpenAPI-style JSON schemas
  - Knowledge base tools: `retrieve_knowledge_bases`, `query_knowledge_base`
  - Memory tools: `retrieve_memory_stores`, `query_memory_store`, `write_memory_store`
- **Memory Stores** - Persistent context across conversations with entity-based isolation
- **Knowledge Bases** - RAG integration for grounding responses
- **Real-time Streaming** - Server-Sent Events for monitoring execution
- **Multi-modal** - Supports images and PDFs

**UI/UX Patterns:**
- API-first approach (agents created via API, not UI)
- Project-based organization
- Traces view for visualizing tool usage
- Task-based execution model with states (submitted, working, input_required, completed)

**What's Missing:**
- No visual agent builder in the UI (API only)
- Human approval workflow is "coming soon"

---

#### 2. Vellum
**Website:** https://vellum.ai

**Agent Capabilities:**
- **Visual Workflow Builder** - Drag-and-drop interface for building agent workflows
- **Agent Node** - Dedicated node type that handles:
  - Automatic OpenAPI schema generation
  - Built-in loop logic for tool calling
  - Output parsing
  - Multiple tool support
- **Tool Types:**
  - Raw code execution (Python/TypeScript)
  - Inline subworkflows
  - Subworkflow deployments
  - Composio integration (Gmail, Notion, Jira, etc.)
- **Function Calling** - Detailed UI for defining function schemas
- **Multi-Agent Workflows** - Examples of specialized agents collaborating

**UI/UX Patterns:**
- **Agent Builder (AI-assisted)** - Natural language to workflow conversion
- Workflow sandbox for testing
- Chat history simulation
- Prompt Node with function blocks
- Function definition via Form or JSON upload
- "Forced" checkbox to always use specific function
- Conditional branching based on output type (function call vs text)
- Clear separation: Prompt Node (LLM) vs Templating Node (data transform) vs Code Node

**Innovative Patterns:**
- Standardized `Function Call` output type for consistent handling
- Max Prompt Iterations setting to prevent infinite loops
- Node Adornments for error handling (Try, Retry)
- Composio integration for pre-built tool connectors

**What's Missing:**
- Complex setup for simple use cases (workflow-first approach)
- Steep learning curve for non-technical users

---

#### 3. Humanloop
**Website:** https://humanloop.com

**Agent Capabilities:**
- **Agents as first-class entities** - Separate from Prompts
- **File Types:** `.prompt` and `.agent` files for version control
- **Tools as managed entities** - Version-controlled tool definitions
- **Flows** - For tracing complex AI workflows (RAG, agents)
- **Evaluators** - Including agent-specific evaluations

**UI/UX Patterns:**
- Prompt Editor with tool calling support
- JSON Schema tool definitions
- Snippet tool for reusable text
- Environment-based deployments
- Strong focus on evaluation and monitoring

**Tool Management:**
- Tools are separate "Files" that can be linked to Prompts
- Version control for tool definitions
- Tool calling in Editor view

**What's Missing:**
- Less focus on agent execution, more on evaluation
- No visual workflow builder

---

#### 4. LangSmith (LangChain)
**Website:** https://smith.langchain.com

**Agent Capabilities:**
- **LangSmith Deployment** - Deploy agents as Agent Servers
- **Agent Builder** - No-code visual interface for agent design
- **Studio** - Visual interface for design, test, and refinement
- **Deep LangGraph Integration** - For complex agent workflows

**UI/UX Patterns:**
- Trace visualization with nested spans
- Session grouping for multi-turn conversations
- Agent graphs visualization
- Prompt testing and versioning

**Strengths:**
- Best-in-class observability for LangChain/LangGraph
- Strong evaluation framework

**What's Missing:**
- Tightly coupled to LangChain ecosystem
- Less useful for non-LangChain agents

---

#### 5. Langfuse
**Website:** https://langfuse.com

**Agent Capabilities:**
- **Observability-focused** - Not an agent builder, but excellent for agent tracing
- **Agent Graphs** - Visualize agent execution flow
- **MCP Tracing** - Model Context Protocol support
- **Session tracking** - Multi-turn conversation tracing

**UI/UX Patterns:**
- Trace detail view with nested spans
- Timeline view for latency debugging
- User tracking for cost attribution
- Prompt Management with playground

**What's Missing:**
- No agent creation/configuration UI
- Observability only, not execution

---

#### 6. Portkey
**Website:** https://portkey.ai

**Agent Capabilities:**
- **Gateway-focused** - Routes requests through their platform
- **Agent Framework Integrations** - Supports many frameworks:
  - OpenAI Agents
  - Autogen, CrewAI, LangChain, LangGraph
  - LlamaIndex, Pydantic AI
  - AWS AgentCore

**UI/UX Patterns:**
- "Bring your own agent" approach
- 2-line integration with existing frameworks
- Analytics and logs for agent runs
- Trace ID filtering

**Strengths:**
- Works with any agent framework
- Production features: caching, reliability, fallbacks

**What's Missing:**
- Not an agent builder - just observability/gateway
- No tool configuration UI

---

#### 7. Helicone
**Website:** https://helicone.ai

**Agent Capabilities:**
- **AI Gateway** - Unified API for 100+ models
- **Observability** - Request logging and monitoring
- **Credits system** - Simplified billing across providers

**What's Missing:**
- No agent-specific features
- Pure gateway/observability play

---

#### 8. PromptLayer
**Website:** https://promptlayer.com

**Agent Capabilities:**
- **Prompt Registry** - Version and manage prompts
- **Evaluations** - Batch testing capabilities

**What's Missing:**
- No agent features
- Prompt management and logging only

---

### Feature Comparison Table

| Feature | Orq.ai | Vellum | Humanloop | LangSmith | Langfuse | Portkey |
|---------|--------|--------|-----------|-----------|----------|---------|
| **Agent Creation UI** | API only | Visual Builder | Limited | Agent Builder | No | No |
| **Visual Workflow Builder** | No | Yes (main feature) | No | Studio | No | No |
| **Tool Definition UI** | API | Form + JSON | Form + JSON | N/A | No | No |
| **Built-in Tools** | Yes | Yes (Composio) | Snippets | N/A | No | No |
| **Custom Function Tools** | Yes | Yes | Yes | Via LangGraph | No | No |
| **Agent Playground** | API | Workflow sandbox | Editor | Studio | Prompt only | No |
| **Tool Call Tracing** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Knowledge Base/RAG** | Yes | Yes | Via Tools | Via LangGraph | No | No |
| **Memory/Persistence** | Yes | Via Code | No | Via LangGraph | Sessions | No |
| **Multi-Agent** | Yes | Yes | No | Via LangGraph | No | Frameworks |
| **Evaluations** | Yes | Yes | Yes (strong) | Yes (strong) | Yes | No |
| **Framework Agnostic** | Yes | Yes | Yes | No (LangChain) | Yes | Yes |

---

### UI/UX Patterns Worth Adopting

#### 1. Tool Definition Interface (Vellum Pattern)
- **Form mode**: Fill in name, description, parameters with types
- **JSON upload mode**: Paste or upload OpenAPI-style schema
- **"Forced" toggle**: Always use this tool vs let model decide
- **Inline testing**: Test tool definition in playground

#### 2. Agent Configuration (Orq.ai Pattern)
- Clear agent properties: key, role, description, instructions
- Model settings: model ID, parameters (temperature, etc.)
- Execution limits: max_iterations, max_execution_time
- Tool selection: checkboxes for available tools

#### 3. Trace Visualization (Langfuse Pattern)
- Nested span view showing agent loop iterations
- Timeline view for latency analysis
- Clear distinction between:
  - LLM calls (model, tokens, cost)
  - Tool calls (input, output, duration)
  - Agent reasoning (thought, action, observation)

#### 4. Workflow Testing (Vellum Pattern)
- Chat history simulation with multi-turn conversations
- Conditional output handling (text vs function call)
- Clear output types for downstream handling

#### 5. Tool Execution Feedback (Orq.ai Pattern)
- Task states: submitted → working → input_required → completed
- Clear error states with recovery options
- Streaming updates via SSE

---

### Gaps & Opportunities

#### What's Missing in the Market

1. **Simple Agent UI for Non-Technical Users**
   - Vellum is powerful but complex
   - Orq.ai is API-only
   - Opportunity: Simple form-based agent creation

2. **Framework-Agnostic Agent Playground**
   - LangSmith is LangChain-only
   - Opportunity: Test any agent implementation

3. **Unified Tool Library**
   - Each platform has different built-in tools
   - Composio is emerging as a standard
   - Opportunity: Curated tool library with easy setup

4. **Agent Evaluation Specific to Tool Usage**
   - Most evals focus on output quality
   - Opportunity: Evaluate tool selection, parameter accuracy

5. **Cost Optimization for Agent Loops**
   - Agents can be expensive (multiple LLM calls)
   - Opportunity: Cost estimation, budget limits, efficiency metrics

#### Agenta's Differentiation Opportunity

Given Agenta's focus on **evaluation and observability**, the opportunity is:

1. **Start with observability** - Best-in-class tracing for agent runs
2. **Add evaluation** - Specific evaluators for agent behavior:
   - Did it use the right tools?
   - Were tool parameters correct?
   - Was the tool output handled correctly?
3. **Simple agent playground** - Test agents without code
4. **Gradual tool configuration** - Start simple, add complexity later

---

### Reference Links

| Platform | Docs | Key Pages |
|----------|------|-----------|
| Orq.ai | https://docs.orq.ai | Agents API, Tools Overview |
| Vellum | https://docs.vellum.ai | Agent Node, Function Calling, Agent Builder |
| Humanloop | https://humanloop.com/docs | Agents, Tools, Flows |
| LangSmith | https://docs.smith.langchain.com | Observability, Deployment |
| Langfuse | https://langfuse.com/docs | Observability, Prompt Management |
| Portkey | https://docs.portkey.ai | Agent Integrations |
| Helicone | https://docs.helicone.ai | AI Gateway |
| PromptLayer | https://docs.promptlayer.com | Prompt Registry |

---

## Findings

### Key Insights from Research

1. **Two Approaches to Agents:**
   - **Builder Approach** (Vellum, LangSmith): Visual workflow builders, complex but powerful
   - **API Approach** (Orq.ai): Programmatic agent creation, flexible but requires code

2. **Tools are Central:**
   - Every platform supports function calling / tool use
   - JSON Schema is the standard for tool definitions
   - Built-in tools (web search, date, etc.) are common

3. **Observability is Table Stakes:**
   - Every platform has tracing/logging
   - Agent-specific visualization (loops, tool calls) is expected

4. **Evaluation is Underserved:**
   - Most platforms focus on general LLM evaluation
   - Agent-specific evaluation (tool selection, loop efficiency) is rare

5. **Memory and RAG are Premium Features:**
   - Knowledge bases and memory stores are common in higher tiers
   - These add significant complexity

---

## Recommendations

### MVP Scope Recommendation

Based on competitive analysis, recommend:

**Phase 1: Agent Observability** (Aligns with Agenta's strengths)
- Agent trace visualization with tool calls
- Loop iteration tracking
- Cost/latency per agent run

**Phase 2: Simple Agent Playground**
- Test existing agent implementations
- View tool definitions (read-only initially)
- Interactive chat testing

**Phase 3: Agent Configuration UI**
- Define tools via form or JSON
- Set agent parameters (max iterations, etc.)
- Built-in tools (web search, date)

**Phase 4: Agent Evaluation**
- Tool selection accuracy evaluators
- Parameter correctness checks
- Loop efficiency metrics

### Out of Scope for MVP

- Visual workflow builder (too complex, Vellum's territory)
- Multi-agent orchestration
- Memory/persistence
- Third-party tool integrations (Composio, etc.)
- Human approval workflows

---

## API Documentation Analysis

This section documents how competitors structure their APIs for agents and tools.

### Orq.ai API

**Base URL:** `https://api.orq.ai`  
**Auth:** Bearer token via `Authorization: Bearer $API_KEY`

#### Agent Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/agents` | Create agent |
| GET | `/v2/agents/{key}` | Get agent |
| GET | `/v2/agents` | List agents |
| PATCH | `/v2/agents/{key}` | Update agent |
| DELETE | `/v2/agents/{key}` | Delete agent |
| POST | `/v2/agents/{key}/responses` | Execute agent (invoke) |
| POST | `/v2/agents/{key}/stream-task` | Execute with SSE streaming |

#### Create Agent Request

```json
POST /v2/agents
{
  "key": "weather-assistant",
  "role": "Assistant",
  "description": "Helps with weather queries",
  "instructions": "Be helpful and concise",
  "path": "Default/agents",
  "model": {
    "id": "openai/gpt-4o",
    "parameters": {
      "temperature": 0.5
    }
  },
  "settings": {
    "max_iterations": 5,
    "max_execution_time": 300,
    "tools": [
      { "type": "current_date" },
      {
        "type": "function",
        "key": "get_weather",
        "display_name": "Get Weather",
        "description": "Get weather for a location",
        "function": {
          "name": "get_weather",
          "parameters": {
            "type": "object",
            "properties": {
              "location": { "type": "string" }
            },
            "required": ["location"]
          }
        }
      }
    ]
  }
}
```

#### Execute Agent Request (A2A Protocol)

```json
POST /v2/agents/weather-assistant/responses
{
  "message": {
    "role": "user",
    "parts": [
      { "kind": "text", "text": "What's the weather in NYC?" }
    ]
  },
  "background": false,
  "stream": false
}
```

#### Execute Agent Response

```json
{
  "_id": "response-id",
  "task_id": "01K6D8QESESZ6SAXQPJPFQXPFT",
  "output": [
    {
      "messageId": "msg-id",
      "role": "agent",
      "parts": [
        { "kind": "text", "text": "The weather in NYC is 72°F and sunny." }
      ]
    }
  ],
  "finish_reason": "stop",
  "model": "openai/gpt-4o",
  "usage": {
    "prompt_tokens": 50,
    "completion_tokens": 25,
    "total_tokens": 75
  }
}
```

#### Tool Call Response (Needs User Execution)

When `finish_reason: "function_call"`, send tool result:

```json
POST /v2/agents/weather-assistant/responses
{
  "task_id": "01K6D8QESESZ6SAXQPJPFQXPFT",
  "message": {
    "role": "tool",
    "parts": [
      {
        "kind": "tool_result",
        "tool_call_id": "call_abc123",
        "result": { "temperature": 72, "conditions": "sunny" }
      }
    ]
  }
}
```

#### Tool Types in Orq.ai

| Type | Description |
|------|-------------|
| `current_date` | Built-in: current date |
| `google_search` | Built-in: web search |
| `web_scraper` | Built-in: scrape URLs |
| `function` | Custom JSON Schema function |
| `retrieve_knowledge_bases` | RAG: discover KBs |
| `query_knowledge_base` | RAG: query KB |
| `query_memory_store` | Memory: search |
| `write_memory_store` | Memory: store |

---

### Vellum API

**Base URLs:**
- Execution: `https://predict.vellum.ai`
- Management: `https://api.vellum.ai`

**Auth:** `X-API-KEY` header

#### Workflow Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/execute-workflow` | Sync execution |
| POST | `/v1/execute-workflow-stream` | SSE streaming |
| POST | `/v1/execute-workflow-async` | Async (returns execution_id) |
| POST | `/v1/execute-prompt` | Execute single prompt |
| POST | `/v1/execute-prompt-stream` | Stream prompt response |

#### Execute Workflow Request

```json
POST /v1/execute-workflow
{
  "workflow_deployment_name": "customer-support-bot",
  "inputs": [
    {
      "name": "user_query",
      "type": "STRING",
      "value": "What's the status of my order?"
    },
    {
      "name": "chat_history",
      "type": "CHAT_HISTORY",
      "value": [
        { "role": "USER", "text": "Hello" },
        { "role": "ASSISTANT", "text": "Hi! How can I help?" }
      ]
    }
  ],
  "release_tag": "LATEST",
  "external_id": "session-123",
  "metadata": { "user_id": "user_abc" }
}
```

#### Execute Workflow Response

```json
{
  "execution_id": "exec_abc123",
  "run_id": "run_xyz789",
  "data": {
    "state": "FULFILLED",
    "outputs": [
      {
        "name": "response",
        "type": "STRING",
        "value": "Your order #12345 has shipped..."
      },
      {
        "name": "function_call",
        "type": "FUNCTION_CALL",
        "value": {
          "name": "get_order_status",
          "arguments": { "order_id": "12345" },
          "id": "call_abc123"
        }
      }
    ]
  }
}
```

#### Vellum Input Types

| Type | Description |
|------|-------------|
| `STRING` | Plain text |
| `NUMBER` | Numeric (double) |
| `JSON` | Arbitrary JSON object |
| `CHAT_HISTORY` | Array of chat messages |
| `IMAGE` | Image (URL, base64, file ref) |
| `AUDIO` | Audio data |
| `DOCUMENT` | PDF/document |

#### Vellum Function Definition (in Prompt Node)

```json
{
  "name": "get_weather",
  "description": "Get weather for a location",
  "parameters": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "City and state"
      },
      "unit": {
        "type": "string",
        "enum": ["celsius", "fahrenheit"]
      }
    },
    "required": ["location"]
  }
}
```

#### Streaming Events (SSE)

```
event: workflow
data: {"state": "INITIATED"}

event: node
data: {"state": "STREAMING", "delta": "The weather ", "name": "response"}

event: node
data: {"state": "STREAMING", "delta": "is sunny", "name": "response"}

event: workflow
data: {"state": "FULFILLED", "outputs": [...]}
```

---

### Humanloop API

**Base URL:** `https://api.humanloop.com/v5`  
**Auth:** `X-API-KEY` header

#### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v5/prompts` | Create/upsert prompt |
| POST | `/v5/prompts/call` | Execute prompt |
| POST | `/v5/prompts/log` | Log external execution |
| POST | `/v5/agents` | Create/upsert agent |
| POST | `/v5/agents/call` | Execute agent |
| POST | `/v5/agents/continue` | Continue after tool call |
| POST | `/v5/tools` | Create/upsert tool |
| POST | `/v5/tools/call` | Execute tool |
| POST | `/v5/flows/log` | Log flow trace |

#### Create Agent Request

```json
POST /v5/agents
{
  "path": "Banking/Teller Agent",
  "model": "claude-3-7-sonnet-latest",
  "provider": "anthropic",
  "endpoint": "chat",
  "max_iterations": 10,
  "template": [
    {
      "role": "system",
      "content": "You are a bank teller. Guidelines: {{personality}}"
    }
  ],
  "tools": [
    {
      "type": "file",
      "link": { "file_id": "tl_123", "version_id": "tlv_456" },
      "on_agent_call": "continue"
    },
    {
      "type": "inline",
      "json_schema": {
        "name": "transfer_funds",
        "description": "Transfer money between accounts",
        "parameters": {
          "type": "object",
          "properties": {
            "from_account": { "type": "string" },
            "to_account": { "type": "string" },
            "amount": { "type": "number" }
          },
          "required": ["from_account", "to_account", "amount"]
        }
      },
      "on_agent_call": "continue"
    },
    {
      "type": "inline",
      "json_schema": {
        "name": "complete_task",
        "description": "Call when task is finished",
        "parameters": {
          "type": "object",
          "properties": { "output": { "type": "string" } }
        }
      },
      "on_agent_call": "stop"
    }
  ]
}
```

#### Execute Agent Request

```json
POST /v5/agents/call
{
  "path": "Banking/Teller Agent",
  "messages": [
    { "role": "user", "content": "I need to withdraw $1000" }
  ],
  "inputs": { "personality": "friendly and professional" },
  "stream": false,
  "include_trace_children": true
}
```

#### Execute Agent Response

```json
{
  "id": "log_abc123",
  "output": "I've processed your withdrawal...",
  "output_message": {
    "role": "assistant",
    "content": "I've processed your withdrawal..."
  },
  "finish_reason": "stopping_tool_called",
  "stopping_tool_names": ["complete_task"],
  "trace_children": [
    { "id": "log_child1", "type": "prompt" },
    { "id": "log_child2", "type": "tool" }
  ]
}
```

#### Continue After Tool Call

```json
POST /v5/agents/continue
{
  "log_id": "log_abc123",
  "messages": [
    {
      "role": "tool",
      "tool_call_id": "call_xyz",
      "content": "{\"status\": \"success\", \"balance\": 5000}"
    }
  ]
}
```

#### Tool Types in Humanloop

| Type | Description |
|------|-------------|
| `json_schema` | Schema-only (user executes) |
| `python` | Executable Python on Humanloop runtime |
| `snippet` | Reusable text snippets |
| `pinecone_search` | Pinecone RAG integration |
| `google` | Google Search |

#### Agent Tool Behavior

| `on_agent_call` | Behavior |
|-----------------|----------|
| `continue` | Agent keeps looping after tool |
| `stop` | Agent terminates when tool called |

---

### API Design Patterns Comparison

| Pattern | Orq.ai | Vellum | Humanloop |
|---------|--------|--------|-----------|
| **Entity model** | Agent + Task | Workflow + Execution | Agent + Log |
| **Tool definition** | Inline in agent | In prompt node | Linked or inline |
| **Continuation** | `task_id` | N/A (workflow handles) | `log_id` + `/continue` |
| **Streaming** | SSE via `/stream-task` | SSE via `-stream` suffix | SSE via `stream: true` |
| **Tool execution** | User sends `tool_result` | Workflow auto-handles | User sends to `/continue` |
| **Stopping** | `max_iterations`, `finish_reason` | Node logic | `on_agent_call: stop` |

---

### Implications for Agenta API Design

Based on competitive analysis, Agenta's agent/tool API should consider:

#### 1. Resource Structure
```
/api/agents                    # Agent configurations
/api/agents/{id}/runs          # Agent executions
/api/tools                     # Tool definitions (org-level)
/api/tools/connections         # Composio connections (per org/user)
```

#### 2. Agent Configuration Schema
```json
{
  "id": "agent_123",
  "name": "Customer Support",
  "system_prompt": "You are a helpful assistant...",
  "model": "gpt-4o",
  "model_params": { "temperature": 0.7 },
  "max_iterations": 10,
  "max_execution_time": 300,
  "tools": [
    { "type": "builtin", "name": "current_date" },
    { "type": "function", "schema": { /* JSON Schema */ } },
    { "type": "composio", "toolkit": "gmail", "action": "send_email" }
  ]
}
```

#### 3. Tool Schema (Universal)
```json
{
  "id": "tool_123",
  "name": "get_weather",
  "description": "Get weather for a location",
  "type": "function",
  "parameters": {
    "type": "object",
    "properties": {
      "location": { "type": "string", "description": "City name" }
    },
    "required": ["location"]
  },
  "source": "inline" | "composio" | "builtin",
  "composio_config": {  // Only if source=composio
    "toolkit": "weather",
    "action": "get_current"
  }
}
```

#### 4. Execution Flow
```
POST /api/agents/{id}/runs
{
  "messages": [{ "role": "user", "content": "..." }],
  "stream": true
}

Response (streaming):
event: started
data: {"run_id": "run_123"}

event: tool_call
data: {"tool": "get_weather", "arguments": {...}, "call_id": "call_1"}

event: tool_result  
data: {"call_id": "call_1", "result": {...}}

event: message
data: {"role": "assistant", "content": "The weather..."}

event: completed
data: {"finish_reason": "stop", "usage": {...}}
```

---

*Research completed: January 2026*
