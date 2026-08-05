# Provider × Tool Matrix Testing

A comprehensive testing script for evaluating LiteLLM's support across three major LLM providers (OpenAI, Anthropic, Google) and their tool capabilities.

## Overview

This script tests 9 major tool capabilities across providers:

| Tool/Capability | Description |
|----------------|-------------|
| **Function Calling** | Basic tool/function calling support |
| **Code Execution** | Python code execution in sandboxed environments |
| **Bash Scripting** | Command-line scripting and execution |
| **Text Editor** | File editing and manipulation tools |
| **URL Context** | Fetching and processing content from URLs |
| **Web Search** | Real-time web search and grounding |
| **File Search** | RAG and document search capabilities |
| **Computer Use** | Screen interaction and automation |
| **Memory Caching** | Prompt caching and conversation memory |

## Setup

### 1. Install Dependencies

```bash
pip install litellm python-dotenv tabulate
```

### 2. Configure API Keys

Copy the example environment file and add your API keys:

```bash
cp env.example .env
```

Edit `.env` and add your API keys:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
```

Note: You only need the API keys for providers you want to test. The script will skip providers without keys.

### 3. Run the Tests

```bash
python tools.tests.py
```

### Tool specs and examples

- `tools.specs.json` keeps lists of tool payloads per provider (newest first).
- `tools.examples.json` keeps lists of examples per provider/tool, and the test runner uses the first example and its first tool entry as the source of truth.

## Expected Output

The script will:

1. Check which API keys are available
2. Run tests for each provider sequentially
3. Display real-time test results
4. Generate a summary matrix table
5. Provide detailed results for each capability

Example output:

```
================================================================================
  SUMMARY: Provider × Tool Support Matrix
================================================================================

+---------------------+----------------+--------------------+------------------+
| Tool/Capability     | OpenAI (GPT)   | Anthropic (Claude) | Google (Gemini)  |
+=====================+================+====================+==================+
| Function Calling    | ✅             | ✅                 | ✅               |
| Code Execution      | ❌             | ✅                 | ✅               |
| Bash Scripting      | ❌             | ✅                 | ❌               |
| Text Editor         | ❌             | ✅                 | ❌               |
| URL Context         | ⚠️             | ✅                 | ✅               |
| Web Search          | ✅             | ✅                 | ✅               |
| File Search         | ❌             | ✅                 | ✅               |
| Computer Use        | ❌             | ✅                 | ❌               |
| Memory Caching      | ✅             | ✅                 | ✅               |
+---------------------+----------------+--------------------+------------------+

Legend:
  ✅  = Supported,   tested, worked
  ❌  = Supported,   tested, failed
  ⛔  = Unsupported
  🚧  = Supported, untested (requires different interface/API)
  🏗️   = Supported, untested (requires specific setup)
  ℹ️   = Supported, untested (not run)
  🔒  = Supported, untested (requires API key)
  ⏭️   = Supported, untested (skipped)
```

## Models Tested

**Note**: This script tests only the **Completion API** (not Assistants API or Responses API)

- **OpenAI**: `gpt-5.1` (latest), `gpt-5`, `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`
- **Anthropic**: `anthropic/claude-opus-4-5-20251101` (latest), `anthropic/claude-sonnet-4-5-20250929`, `anthropic/claude-opus-4-1-20250805`, `anthropic/claude-sonnet-4-20250514`, `anthropic/claude-opus-4-20250514`, `anthropic/claude-3-7-sonnet-20250219`, `anthropic/claude-3-5-sonnet-20241022`
- **Google**: `gemini/gemini-3-pro-preview` (latest), `gemini/gemini-2.5-flash`, `gemini/gemini-2.0-flash`, `gemini/gemini-2.0-flash-lite`

**Note**: Models are sourced from `/agenta/sdk/agenta/sdk/assets.py` - latest/most useful production models only. First model in each list is the newest.

## Test Configuration

You can customize which models, providers, and tools to test using environment variables:

### MODELS - Select which models to test

Test only the newest model per provider (faster):
```bash
MODELS=newest python tools.tests.py
```

Test all models (default):
```bash
MODELS=all python tools.tests.py
```

### PROVIDERS - Select which providers to test

Test specific providers only:
```bash
PROVIDERS=anthropic python tools.tests.py
PROVIDERS=openai,google python tools.tests.py
```

Test all providers (default):
```bash
PROVIDERS=all python tools.tests.py
```

### TOOLS - Select which tools to test

Test specific tools only:
```bash
TOOLS=function_calling,code_execution python tools.tests.py
TOOLS=web_search,file_search python tools.tests.py
```

Available tools (use snake_case):
- `function_calling`
- `code_execution`
- `bash_scripting`
- `text_editor`
- `url_context`
- `web_search`
- `file_search`
- `computer_use`
- `memory_caching`

Test all tools (default):
```bash
TOOLS=all python tools.tests.py
```

### Combining Options

You can combine multiple options for focused testing:

```bash
# Test only newest Anthropic model with code execution tools
MODELS=newest PROVIDERS=anthropic TOOLS=code_execution,bash_scripting python tools.tests.py

# Test all OpenAI and Google models with search capabilities only
PROVIDERS=openai,google TOOLS=web_search,file_search python tools.tests.py

# Quick test of newest models across all providers
MODELS=newest python tools.tests.py
```

### Setting in .env File

Add these to your `.env` file for persistent configuration:

```bash
MODELS=newest
PROVIDERS=all
TOOLS=all
```

### Save Output to File

Save test results while viewing them in real-time:

```bash
python tools.tests.py | tee test_results.txt

# With custom configuration
MODELS=newest PROVIDERS=anthropic python tools.tests.py | tee anthropic_quick.txt
```

## Key Findings

### Anthropic (Claude)
- Most feature-rich for agentic workflows
- Only provider with Computer Use, Text Editor, and Bash Scripting
- Strong tool integration via LiteLLM
- Full code execution support in completion API
- Available models: Opus 4, Opus 4.5, Sonnet 4.5, Sonnet 3.5

### OpenAI (GPT)
- No code execution or file search in completion API
- Web search available via specific models
- Prompt caching supported

### Google (Gemini)
- Excellent Google Search grounding
- Native code execution support in completion API
- File search with managed RAG available

## Troubleshooting

### Common Issues

**ImportError: No module named 'litellm'**
```bash
pip install litellm python-dotenv tabulate
```

**API Key Errors**
- Ensure your `.env` file is in the same directory as the script
- Check that API keys are valid and have sufficient credits
- Verify environment variables are loaded: `echo $OPENAI_API_KEY`

**Timeout Errors**
- Some tests may timeout due to slow API responses
- The script uses 30-60 second timeouts
- Web search tests may take longer

**Unsupported Feature Errors**
- Some features require beta headers or special model versions
- The script handles these gracefully and reports the limitation

## Customization

You can modify the script to:

- Test different models (edit `PROVIDERS` dict)
- Add custom tools and capabilities
- Adjust timeout values
- Enable verbose logging: `litellm.set_verbose = True`

## References

- [LiteLLM Documentation](https://docs.litellm.ai/docs/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Anthropic Claude API](https://docs.anthropic.com/)
- [Google Gemini API](https://ai.google.dev/gemini-api/docs)

## License

This is a testing utility script. Use according to your organization's policies and the respective API provider terms of service.
