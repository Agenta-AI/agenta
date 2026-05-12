#!/usr/bin/env python3
"""
Provider x Tool Matrix Testing Script for LiteLLM
Tests OpenAI (GPT), Anthropic (Claude), and Google (Gemini) across major tool capabilities.

Required Environment Variables:
- OPENAI_API_KEY
- ANTHROPIC_API_KEY
- GOOGLE_APPLICATION_CREDENTIALS or GEMINI_API_KEY

Install: pip install litellm python-dotenv
"""

import os
import sys
from typing import Dict, Tuple
import json

try:
    import litellm
    from dotenv import load_dotenv
except ImportError:
    print("Error: Missing required packages. Install with:")
    print("pip install litellm python-dotenv")
    sys.exit(1)

load_dotenv()


ICON___SUPPORTED___TESTED_WORKED = "✅"
ICON___SUPPORTED___TESTED_FAILED = "❌"
ICON___SUPPORTED_UNTESTED_REQUIRES_DIFFERENT_API = "🚧"
ICON___SUPPORTED_UNTESTED_REQUIRES_PRIOR_SETUP = "🏗️ "
ICON___SUPPORTED_UNTESTED_REQUIRES_API_KEY = "🔒"
ICON___SUPPORTED_UNTESTED_SKIPPED = "⏭️ "
ICON___SUPPORTED_UNTESTED = "ℹ️ "
ICON_UNSUPPORTED = "⛔"

LEGEND_MESSAGES = {
    ICON___SUPPORTED___TESTED_WORKED: "  supported,   tested, worked".ljust(30),
    ICON___SUPPORTED___TESTED_FAILED: "  supported,   tested, failed".ljust(30),
    ICON___SUPPORTED_UNTESTED_REQUIRES_DIFFERENT_API: "  supported, untested, api".ljust(
        30
    ),
    ICON___SUPPORTED_UNTESTED_REQUIRES_PRIOR_SETUP: "  supported, untested, setup".ljust(
        30
    ),
    ICON___SUPPORTED_UNTESTED_REQUIRES_API_KEY: "  supported, untested, apikey".ljust(
        30
    ),
    ICON___SUPPORTED_UNTESTED_SKIPPED: "  supported, untested, skip".ljust(30),
    ICON___SUPPORTED_UNTESTED: "  supported, untested".ljust(30),
    ICON_UNSUPPORTED: "unsupported".ljust(30),
}

TOOL_DISPLAY_NAMES = {
    "function_calling": "Function Calling",
    "code_execution": "Code Execution",
    "bash_scripting": "Bash Scripting",
    "text_editor": "Text Editor",
    "url_context": "URL Context",
    "web_search": "Web Search",
    "file_search": "File Search",
    "mcp_calling": "MCP Calling",
    "computer_use": "Computer Use",
    "image_generation": "Image Generation",
    "memory_caching": "Memory/Caching",
}

ALL_PROVIDERS_AND_MODELS = {
    "openai": {
        "models": [
            "gpt-5.1",
            "gpt-5",
            "gpt-5-mini",
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4o",
            "gpt-4o-mini",
        ],
    },
    "anthropic": {
        "models": [
            "anthropic/claude-opus-4-5-20251101",
            "anthropic/claude-sonnet-4-5-20250929",
            "anthropic/claude-opus-4-1-20250805",
            "anthropic/claude-sonnet-4-20250514",
            "anthropic/claude-opus-4-20250514",
            "anthropic/claude-3-7-sonnet-20250219",
            "anthropic/claude-3-5-sonnet-20241022",
            "anthropic/claude-3-5-sonnet-20240620",
        ],
    },
    "google": {
        "models": [
            # "gemini/gemini-3-pro-preview",  # has issues, notably with web search
            "gemini/gemini-2.5-flash",
            "gemini/gemini-2.0-flash",
            "gemini/gemini-2.0-flash-lite",
        ],
    },
}

ALL_TOOLS = [
    "function_calling",
    "code_execution",
    "bash_scripting",
    "text_editor",
    "url_context",
    "web_search",
    "file_search",
    "mcp_calling",
    "computer_use",
    "image_generation",
    "memory_caching",
]

models_filter = os.getenv("MODELS", "all").lower()

providers_env = os.getenv("PROVIDERS", "all").lower()
if providers_env == "all":
    enabled_providers = list(ALL_PROVIDERS_AND_MODELS.keys())
else:
    enabled_providers = [
        p.strip()
        for p in providers_env.split(",")
        if p.strip() in ALL_PROVIDERS_AND_MODELS
    ]
    if not enabled_providers:
        print(
            f"Error: Invalid PROVIDERS value '{providers_env}'. Must be 'all' or comma-separated list of: openai, anthropic, google"
        )
        sys.exit(1)

tools_env = os.getenv("TOOLS", "all").lower()
if tools_env == "all":
    enabled_tools = ALL_TOOLS
else:
    enabled_tools = [t.strip() for t in tools_env.split(",") if t.strip() in ALL_TOOLS]
    if not enabled_tools:
        print(
            f"Error: Invalid TOOLS value '{tools_env}'. Must be 'all' or comma-separated list from: {', '.join(ALL_TOOLS)}"
        )
        sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXAMPLES_PATH = os.path.join(SCRIPT_DIR, "tools.examples.json")
SAMPLES_DIR = os.path.join(SCRIPT_DIR, "samples")
TEST_URL_PATH = os.path.join(SAMPLES_DIR, "url.txt")

PROVIDERS = {
    k: v for k, v in ALL_PROVIDERS_AND_MODELS.items() if k in enabled_providers
}


def load_tool_examples() -> Dict:
    """Load tool examples from JSON, falling back to empty dict on error."""
    try:
        with open(EXAMPLES_PATH, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        print(
            f"⚠️ tools.examples.json not found at {EXAMPLES_PATH}, using inline defaults."
        )
    except json.JSONDecodeError as e:
        print(f"⚠️ Failed to parse tools.examples.json: {e}")
    return {}


TOOL_EXAMPLES = load_tool_examples()
TEST_URL = None


def get_test_url() -> str:
    """Read the dummy URL from samples/url.txt, fallback to example.com."""
    global TEST_URL
    if TEST_URL:
        return TEST_URL
    try:
        with open(TEST_URL_PATH, "r") as f:
            line = f.readline().strip()
            if line:
                TEST_URL = line
                return TEST_URL
    except FileNotFoundError:
        pass
    TEST_URL = "https://example.com"
    return TEST_URL


def get_first_example(provider: str, tool: str) -> Dict:
    """
    Return the first example for a provider/tool and the first tool payload in that example.
    tools.examples.json stores lists so the first entry is the latest.
    """
    provider_examples = TOOL_EXAMPLES.get(provider, {})
    if not provider_examples:
        return {}

    raw_example = provider_examples.get(tool, [])
    example = raw_example[0] if isinstance(raw_example, list) else raw_example
    if not example:
        return {}

    raw_tools = example.get("tools")
    # Preserve empty tools array for tests that don't use tools
    if isinstance(raw_tools, list) and len(raw_tools) == 0:
        tools_to_return = []
    elif isinstance(raw_tools, list) and len(raw_tools) > 0:
        tools_to_return = [raw_tools[0]]  # First tool only
    else:
        tools_to_return = None

    return {
        "messages": example.get("messages"),
        "tools": tools_to_return,
        "extra_headers": example.get("extra_headers"),
    }


def extract_messages_and_tools(example: Dict, tool_key: str) -> Tuple:
    """Return messages/tools or a skipped status when missing."""
    messages = example.get("messages")
    tools = example.get("tools")
    # Tools can be None (missing) or empty list [] (valid for some tests like url_context)
    if not messages or tools is None:
        return (
            None,
            None,
            (
                ICON___SUPPORTED_UNTESTED_SKIPPED,
                f"Skipped: no example messages/tools for {tool_key}",
            ),
        )
    return messages, tools, None


def format_status(icon: str, detail: str) -> str:
    """Compose a status line using legend text plus optional detail."""
    general = LEGEND_MESSAGES.get(icon, "")
    detail = (detail or "").strip()
    if detail:
        return f"{icon} {general} [{detail}]"
    return f"{icon} {general}"


results = {provider: {} for provider in enabled_providers}


def print_header(text: str):
    """Print formatted section header"""
    print(f"\n{'=' * 80}")
    print(f"  {text}")
    print(f"{'=' * 80}\n")


def test_function_calling(provider: str, model: str) -> Tuple[bool, str]:
    """Test function calling capability"""
    try:
        example = get_first_example(provider, "function_calling")
        messages, tools, skipped = extract_messages_and_tools(
            example, "function_calling"
        )
        if skipped:
            return skipped
        response = litellm.completion(
            model=model,
            messages=messages,
            tools=tools,
            # tool_choice="required",
            timeout=30,
        )

        if (
            hasattr(response.choices[0].message, "tool_calls")
            and response.choices[0].message.tool_calls
        ):
            return ICON___SUPPORTED___TESTED_WORKED, ""
        else:
            return ICON___SUPPORTED___TESTED_FAILED, "No tool calls in response"

    except Exception as e:
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {str(e)}"


def test_code_execution(provider: str, model: str) -> Tuple[bool, str]:
    """Test code execution capability"""
    try:
        if provider == "openai":
            # OpenAI code_interpreter is only available in Responses API, not Chat Completions API
            # Chat Completions API only supports 'function' and 'custom' tool types
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_DIFFERENT_API,
                "Requires Responses API",
            )

        elif provider == "anthropic":
            example = get_first_example(provider, "code_execution")
            messages, tools, skipped = extract_messages_and_tools(
                example, "code_execution"
            )
            if skipped:
                return skipped
            extra_headers = example.get("extra_headers")
            response = litellm.completion(
                model=model,
                messages=messages,
                tools=tools,
                # tool_choice="required",
                timeout=60,
                extra_headers=extra_headers,
            )
            return ICON___SUPPORTED___TESTED_WORKED, ""

        elif provider == "google":
            example = get_first_example(provider, "code_execution")
            messages, tools, skipped = extract_messages_and_tools(
                example, "code_execution"
            )
            if skipped:
                return skipped
            response = litellm.completion(  # noqa: F841
                model=model,
                messages=messages,
                tools=tools,
                timeout=60,
            )
            return ICON___SUPPORTED___TESTED_WORKED, ""

        else:
            return ICON_UNSUPPORTED, ""

    except Exception as e:
        error_msg = str(e)
        if (
            "code_execution" in error_msg.lower()
            or "not supported" in error_msg.lower()
        ):
            return ICON_UNSUPPORTED, error_msg
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {error_msg}"


def test_web_search(provider: str, model: str) -> Tuple[bool, str]:
    """Test web search capability"""
    try:
        example = get_first_example(provider, "web_search")
        messages, tools, skipped = extract_messages_and_tools(example, "web_search")
        if skipped:
            return skipped

        if provider == "openai":
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_DIFFERENT_API,
                "Requires Responses API",
            )

        elif provider == "anthropic":
            # Anthropic web search tool
            response = litellm.completion(
                model=model,
                messages=messages,
                tools=tools,
                timeout=60,
            )
            return ICON___SUPPORTED___TESTED_WORKED, ""

        elif provider == "google":
            # Gemini Google Search grounding
            response = litellm.completion(  # noqa: F841
                model=model,
                messages=messages,
                tools=tools,
                timeout=60,
            )
            return ICON___SUPPORTED___TESTED_WORKED, ""

        else:
            return ICON_UNSUPPORTED, ""

    except Exception as e:
        error_msg = str(e)
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {error_msg}"


def test_url_context(provider: str, model: str) -> Tuple[bool, str]:
    """Test URL context/fetching capability"""
    try:
        example = get_first_example(provider, "url_context")
        messages, tools, skipped = extract_messages_and_tools(example, "url_context")
        if skipped:
            return skipped

        # inject runtime URL value into the first user message if placeholder present
        test_url = get_test_url()
        if messages and isinstance(messages, list):
            for m in messages:
                if (
                    isinstance(m, dict)
                    and m.get("role") == "user"
                    and isinstance(m.get("content"), str)
                ):
                    m["content"] = m["content"].replace("{{TEST_URL}}", test_url)

        if provider == "google":
            response = litellm.completion(
                model=model,
                messages=messages,
                tools=tools if tools else None,
                timeout=90,
            )
        else:
            response = litellm.completion(  # noqa: F841
                model=model,
                messages=messages,
                tools=tools if tools else None,
                timeout=60,
            )
        return ICON___SUPPORTED___TESTED_WORKED, ""

    except Exception as e:
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {str(e)}"


def test_text_editor(provider: str, model: str) -> Tuple[bool, str]:
    """Test text editor tool capability"""
    try:
        if provider == "anthropic":
            # text_editor_20250728 is the latest version, requires name: "str_replace_based_edit_tool"
            example = get_first_example(provider, "text_editor")
            messages, tools, skipped = extract_messages_and_tools(
                example, "text_editor"
            )
            if skipped:
                return skipped
            response = litellm.completion(  # noqa: F841
                model=model,
                messages=messages,
                tools=tools,
                # tool_choice="required",
                timeout=30,
            )
            return ICON___SUPPORTED___TESTED_WORKED, ""
        else:
            return ICON_UNSUPPORTED, ""

    except Exception as e:
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {str(e)}"


def test_bash_scripting(provider: str, model: str) -> Tuple[bool, str]:
    """Test bash scripting tool capability"""
    try:
        if provider == "openai":
            # OpenAI local_shell is only available in Responses API, not Chat Completions API
            # Chat Completions API only supports 'function' and 'custom' tool types
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_DIFFERENT_API,
                "Requires Responses API",
            )
        elif provider == "anthropic":
            # Anthropic supports bash tool (bash_20250124 - updated from bash_20241022)
            example = get_first_example(provider, "bash_scripting")
            messages, tools, skipped = extract_messages_and_tools(
                example, "bash_scripting"
            )
            if skipped:
                return skipped
            response = litellm.completion(  # noqa: F841
                model=model,
                messages=messages,
                tools=tools,
                # tool_choice="required",
                timeout=30,
            )
            return ICON___SUPPORTED___TESTED_WORKED, ""
        else:
            return ICON_UNSUPPORTED, ""

    except Exception as e:
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {str(e)}"


def test_computer_use(provider: str, model: str) -> Tuple[bool, str]:
    """Test computer use capability"""
    try:
        if provider == "openai":
            # OpenAI computer_use is only available in Responses API, not Chat Completions API
            # Chat Completions API only supports 'function' and 'custom' tool types
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_DIFFERENT_API,
                "Requires Responses API",
            )
        elif provider == "anthropic":
            # Anthropic supports computer use tools (computer_20241022)
            # Computer use is available for Claude Opus and Sonnet models
            return ICON___SUPPORTED_UNTESTED, "TBD"
        else:
            return ICON_UNSUPPORTED, ""

    except Exception as e:
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {str(e)}"


def test_file_search(provider: str, model: str) -> Tuple[bool, str]:
    """Test file search/RAG capability"""
    try:
        if provider == "openai":
            # OpenAI file_search is only available in Responses API, not Chat Completions API
            # Chat Completions API only supports 'function' and 'custom' tool types
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_DIFFERENT_API,
                "Requires Responses API",
            )
        elif provider == "google":
            # Gemini File Search is available but requires file upload
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_PRIOR_SETUP,
                "Requires file setup",
            )
        elif provider == "anthropic":
            # Claude supports PDF and document analysis
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_PRIOR_SETUP,
                "Requires file setup",
            )
        else:
            return ICON_UNSUPPORTED, ""
    except Exception as e:
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {str(e)}"


def test_mcp_calling(provider: str, model: str) -> Tuple[bool, str]:
    """Test MCP (Model Context Protocol) capability"""
    try:
        if provider == "openai":
            # OpenAI remote_mcp is only available in Responses API, not Chat Completions API
            # Chat Completions API only supports 'function' and 'custom' tool types
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_DIFFERENT_API,
                "Requires Responses API",
            )
        elif provider == "anthropic":
            # Anthropic doesn't have native MCP in completion API
            return ICON_UNSUPPORTED, "Unsupported in completion API"
        elif provider == "google":
            # Google doesn't have native MCP in completion API
            return ICON_UNSUPPORTED, "Unsupported in completion API"
        else:
            return ICON_UNSUPPORTED, ""
    except Exception as e:
        # MCP might not be widely available yet, so we check the error
        error_msg = str(e).lower()
        if "remote_mcp" in error_msg or "mcp" in error_msg:
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_PRIOR_SETUP,
                "MCP format supported (needs server setup)",
            )
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {str(e)}"


def test_image_generation(provider: str, model: str) -> Tuple[bool, str]:
    """Test image generation capability"""
    try:
        if provider == "openai":
            # OpenAI image_generation is only available in Responses API, not Chat Completions API
            # Chat Completions API only supports 'function' and 'custom' tool types
            return (
                ICON___SUPPORTED_UNTESTED_REQUIRES_DIFFERENT_API,
                "Requires Responses API",
            )
        elif provider == "anthropic":
            # Anthropic doesn't have native image generation in completion API
            return ICON_UNSUPPORTED, "Unsupported in completion API"
        elif provider == "google":
            # Google doesn't have native image generation tool in completion API
            # (Imagen is separate)
            return ICON_UNSUPPORTED, "Unsupported in completion API"
        else:
            return ICON_UNSUPPORTED, ""
    except Exception as e:
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {str(e)}"


def test_memory_caching(provider: str, model: str) -> Tuple[bool, str]:
    """Test memory caching capability"""
    try:
        if provider == "anthropic":
            # Anthropic prompt caching
            return ICON___SUPPORTED_UNTESTED, "TBD"
        elif provider == "google":
            # Gemini context caching
            return ICON___SUPPORTED_UNTESTED, "TBD"
        elif provider == "openai":
            # OpenAI prompt caching in completion API
            return ICON___SUPPORTED_UNTESTED, "TBD"
        else:
            return ICON_UNSUPPORTED, ""
    except Exception as e:
        return ICON___SUPPORTED___TESTED_FAILED, f"Exception: {str(e)}"


def check_api_keys() -> Dict[str, bool]:
    """Check which API keys are available"""
    keys_status = {
        "openai": bool(os.getenv("OPENAI_API_KEY")),
        "anthropic": bool(os.getenv("ANTHROPIC_API_KEY")),
        "google": bool(os.getenv("GEMINI_API_KEY")),
    }
    return keys_status


def run_all_tests():
    """Run all tests across all providers and models"""
    print_header("Provider x Model × Tool Matrix Testing Script")

    # Show configuration
    if len(enabled_providers) < len(ALL_PROVIDERS_AND_MODELS):
        print(f"🔍 PROVIDERS={','.join(enabled_providers)}")
    else:
        print("🌐 PROVIDERS=all")

    if models_filter == "newest":
        print("⚡ MODELS=newest")
    else:
        print("📋 MODELS=all")

    if len(enabled_tools) < len(ALL_TOOLS):
        print(f"🔧 TOOLS={','.join(enabled_tools)}")
    else:
        print("🔧 TOOLS=all")

    print()

    # Check API keys
    keys_status = check_api_keys()
    for provider, has_key in keys_status.items():
        status = "✅" if has_key else ICON___SUPPORTED_UNTESTED_REQUIRES_API_KEY
        print(
            f"{status} {provider.upper()}:".ljust(16),
            f" {'Available' if has_key else 'Missing'}",
        )

    if not any(keys_status.values()):
        print(
            f"\n{ICON___SUPPORTED_UNTESTED_REQUIRES_API_KEY} No API keys found. Please set environment variables:"
        )
        print("   - OPENAI_API_KEY")
        print("   - ANTHROPIC_API_KEY")
        print("   - GEMINI_API_KEY")
        return

    # Test each provider
    for provider, config in PROVIDERS.items():
        if not keys_status[provider]:
            print(
                f"\n{ICON___SUPPORTED_UNTESTED_REQUIRES_API_KEY} Skipping {provider.upper()} - No API key"
            )
            continue

        print_header(f"Testing {provider.upper()}")

        # Select models to test based on MODELS env var
        models_to_test = (
            [config["models"][0]] if models_filter == "newest" else config["models"]
        )

        if models_filter == "newest":
            print(f"⚡ Testing only newest model: {models_to_test[0]}\n")
        else:
            print(
                f"Testing {len(config['models'])} models: {', '.join(config['models'])}\n"
            )

        # Test each model for this provider
        for model_idx, model in enumerate(models_to_test, 1):
            print(f"[Model {model_idx}/{len(models_to_test)}] {model}")
            print("-" * 80)

            model_results = {}

            # Mapping of tool names to test functions
            tool_tests = {
                "function_calling": lambda: test_function_calling(provider, model),
                "code_execution": lambda: test_code_execution(provider, model),
                "bash_scripting": lambda: test_bash_scripting(provider, model),
                "text_editor": lambda: test_text_editor(provider, model),
                "url_context": lambda: test_url_context(provider, model),
                "web_search": lambda: test_web_search(provider, model),
                "file_search": lambda: test_file_search(provider, model),
                "mcp_calling": lambda: test_mcp_calling(provider, model),
                "computer_use": lambda: test_computer_use(provider, model),
                "image_generation": lambda: test_image_generation(provider, model),
                "memory_caching": lambda: test_memory_caching(provider, model),
            }

            # Run only enabled tools
            for idx, tool in enumerate(enabled_tools, 1):
                print(f"  {idx}".rjust(4) + f". [{tool}]")

                # test_* returns: (icon, detail)
                status_icon, detail = tool_tests[tool]()

                # derive legend message from icon
                legend_message = LEGEND_MESSAGES.get(status_icon, "")

                # store full triple: icon, legend message, detail
                model_results[tool] = (status_icon, legend_message, detail)

                # print in the desired format: icon, legend.message, <details>
                if detail:
                    print(
                        f"      {'-' * 18}>".ljust(25)
                        + f" {status_icon} {legend_message} [{detail}]"
                    )
                else:
                    print(
                        f"      {'-' * 18}>".ljust(25)
                        + f" {status_icon} {legend_message}"
                    )

            # Store results for this specific model
            results[f"{provider}_{model}"] = model_results
            print()  # Blank line between models

    # Generate summary table by model
    print_header("DETAILED RESULTS BY MODEL")

    for provider in enabled_providers:
        provider_models = [
            key for key in results.keys() if key.startswith(f"{provider}_")
        ]
        if not provider_models:
            continue

        print(f"\n{provider.upper()}:")
        for model_key in provider_models:
            model_name = model_key.replace(f"{provider}_", "")
            print(f"\n  Model: {model_name}")
            print("  " + "-" * 78)
            for tool in enabled_tools:
                if tool in results[model_key]:
                    status_icon, legend_message, detail = results[model_key][tool]
                    if detail and not detail.startswith("Exception"):
                        status_str = (
                            f"{status_icon} {legend_message}".ljust(30) + f" [{detail}]"
                        )
                    else:
                        status_str = f"{status_icon} {legend_message}"
                    print(f"    [{tool}]".ljust(25) + f" {status_str}")

    print("\n" + "=" * 80)
    print("📖 Legend:")
    print(f"{'=' * 80}")
    for icon, text in LEGEND_MESSAGES.items():
        print(f"  {icon}  = {text}")

    # Tool specifications and examples are now in separate files
    print(f"\n{'=' * 80}")
    print("📚 Docs:")
    print(f"{'=' * 80}")
    print("  📝 tools.specs.json    - Specifications")
    print("  📝 tools.examples.json - Examples")


if __name__ == "__main__":
    try:
        # Run the tests
        run_all_tests()
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Unexpected error: {str(e)}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
