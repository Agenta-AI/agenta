# OpenTelemetry Quick Start Example

This example demonstrates how to instrument a Node.js application with OpenTelemetry and send traces to Agenta.

## Prerequisites

- Node.js 18+ installed
- Agenta API key ([get one here](https://cloud.agenta.ai))
- OpenAI API key

## Version Compatibility

This example uses the latest stable versions:
- **OpenAI SDK** (`latest` - v6.x)
- **OpenInference Instrumentation** (`latest` - v3.x)
- **OpenInference Semantic Conventions** (`latest` - v2.x)

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Create a `.env` file with your credentials:
```bash
cp .env.example .env
# Edit .env and add your API keys
```

3. Run the example:
```bash
pnpm start
```

## What's Happening?

1. **instrumentation.js** - Configures OpenTelemetry to:
   - Send traces to Agenta via OTLP
   - Automatically instrument OpenAI calls using OpenInference
   - Use SimpleSpanProcessor for immediate export (ideal for short scripts)

2. **app.js** - A simple application that:
   - Creates a manual span using Agenta's semantic conventions
   - Calls OpenAI's chat completion API (auto-instrumented)
   - Demonstrates proper use of `ag.data.inputs`, `ag.data.outputs`, and `ag.data.internals`

3. All traces are sent to Agenta where you can:
   - View the complete trace timeline
   - See inputs/outputs with proper formatting
   - Monitor costs and latency
   - Debug issues

## Semantic Conventions

This example follows Agenta's semantic conventions for proper trace display:

- **`ag.type.node`** - Defines the operation type (workflow, task, tool, etc.)
- **`ag.data.inputs`** - Stores input parameters as JSON
- **`ag.data.outputs`** - Stores output results as JSON
- **`ag.data.internals`** - Stores intermediate values and metadata

See [SEMANTIC_CONVENTIONS.md](./SEMANTIC_CONVENTIONS.md) for detailed documentation.

## View Your Traces

After running the example, log in to [Agenta](https://cloud.agenta.ai) and navigate to the Observability section to see your traces!
