#!/usr/bin/env python
"""
Generate tool specifications and examples files for all providers and tools.
This script creates tools.specs and tools.examples files containing comprehensive
documentation regardless of test filters.
"""

import json


def generate_specifications():
    """Generate tools.specs file with all tool format specifications"""
    specs = {
        "openai": {
            "function_calling": [
                {
                    "type": "function",
                    "function": {
                        "name": "example_function",
                        "description": "Description of the function",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "param_name": {
                                    "type": "string",
                                    "description": "Parameter description",
                                }
                            },
                            "required": ["param_name"],
                        },
                    },
                }
            ],
            "code_execution": [
                {
                    "type": "code_interpreter",
                    "container": {"type": "auto", "memory_limit": "4g"},
                }
            ],
            "bash_scripting": [{"type": "local_shell"}],
            "web_search": [{"type": "web_search"}],
            "web_search_with_filters": [
                {
                    "type": "web_search",
                    "filters": {
                        "allowed_domains": [
                            "pubmed.ncbi.nlm.nih.gov",
                            "clinicaltrials.gov",
                        ]
                    },
                }
            ],
            "file_search": [{"type": "file_search"}],
            "mcp_calling": [
                {
                    "type": "remote_mcp",
                    "server": {
                        "url": "https://example-mcp-server.com",
                        "token": "your-auth-token",
                    },
                }
            ],
            "computer_use": [{"type": "computer_use"}],
            "image_generation": [{"type": "image_generation"}],
        },
        "anthropic": {
            "function_calling": [
                {
                    "type": "function",
                    "function": {
                        "name": "example_function",
                        "description": "Description",
                        "parameters": {
                            "type": "object",
                            "properties": {"param": {"type": "string"}},
                            "required": ["param"],
                        },
                    },
                }
            ],
            "code_execution": [
                {"type": "code_execution_20250825", "name": "code_execution"}
            ],
            "bash_scripting": [{"type": "bash_20250124", "name": "bash"}],
            "text_editor": [
                {"type": "text_editor_20250728", "name": "str_replace_based_edit_tool"}
            ],
            "web_search": [{"type": "web_search_20250305", "name": "web_search"}],
            "computer_use": [
                {
                    "type": "computer_20241022",
                    "name": "computer",
                    "display_width_px": 1024,
                    "display_height_px": 768,
                    "display_number": 1,
                }
            ],
            "extra_headers": {"anthropic-beta": "code-execution-2025-08-25"},
        },
        "google": {
            "function_calling": [
                {
                    "type": "function",
                    "function": {
                        "name": "example_function",
                        "description": "Description",
                        "parameters": {
                            "type": "object",
                            "properties": {"param": {"type": "string"}},
                            "required": ["param"],
                        },
                    },
                }
            ],
            "code_execution": [{"code_execution": {}}],
            "web_search": [{"googleSearch": {}}],
            "web_search_with_options": [
                {"googleSearch": {"web_search_options": "medium"}}
            ],
        },
    }

    with open("tools.specs.json", "w") as f:
        json.dump(specs, f, indent=2)

    print("📝 Created tools.specs.json")
    return specs


def generate_examples():
    """Generate tools.examples file with message body examples (JSON, not stringified)"""
    examples = {
        "openai": {
            "function_calling": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "What's the weather in San Francisco?",
                        }
                    ],
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "description": "Get current weather",
                                "parameters": {
                                    "type": "object",
                                    "properties": {
                                        "location": {
                                            "type": "string",
                                            "description": "City name",
                                        }
                                    },
                                    "required": ["location"],
                                },
                            },
                        }
                    ],
                }
            ],
            "code_execution": [
                {
                    "messages": [
                        {"role": "user", "content": "Calculate fibonacci(10)"}
                    ],
                    "tools": [{"type": "code_interpreter"}],
                }
            ],
            "bash_scripting": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "List all Python files in the current directory",
                        }
                    ],
                    "tools": [{"type": "local_shell"}],
                }
            ],
            "url_context": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "Fetch content from https://example.com",
                        }
                    ],
                    "tools": [],
                }
            ],
            "web_search": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "What are the latest developments in AI?",
                        }
                    ],
                    "tools": [{"type": "web_search"}],
                }
            ],
            "file_search": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "Search for information about project timeline",
                        }
                    ],
                    "tools": [{"type": "file_search"}],
                }
            ],
            "mcp_calling": [
                {
                    "messages": [{"role": "user", "content": "Fetch data via MCP"}],
                    "tools": [
                        {
                            "type": "remote_mcp",
                            "server": {
                                "url": "https://mcp-server.com",
                                "token": "token",
                            },
                        }
                    ],
                }
            ],
            "computer_use": [
                {
                    "messages": [
                        {"role": "user", "content": "Click the settings button"}
                    ],
                    "tools": [{"type": "computer_use"}],
                }
            ],
            "image_generation": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "Generate an image of a sunset over mountains",
                        }
                    ],
                    "tools": [{"type": "image_generation"}],
                }
            ],
        },
        "anthropic": {
            "function_calling": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "What's the weather in San Francisco?",
                        }
                    ],
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "description": "Get current weather",
                                "parameters": {
                                    "type": "object",
                                    "properties": {
                                        "location": {
                                            "type": "string",
                                            "description": "City name",
                                        }
                                    },
                                    "required": ["location"],
                                },
                            },
                        }
                    ],
                }
            ],
            "code_execution": [
                {
                    "messages": [
                        {"role": "user", "content": "Calculate fibonacci(10)"}
                    ],
                    "tools": [
                        {"type": "code_execution_20250825", "name": "code_execution"}
                    ],
                    "extra_headers": {"anthropic-beta": "code-execution-2025-08-25"},
                }
            ],
            "bash_scripting": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "List all files in the current directory",
                        }
                    ],
                    "tools": [{"type": "bash_20250124", "name": "bash"}],
                }
            ],
            "text_editor": [
                {
                    "messages": [
                        {"role": "user", "content": "Edit file.txt to add a new line"}
                    ],
                    "tools": [
                        {
                            "type": "text_editor_20250728",
                            "name": "str_replace_based_edit_tool",
                        }
                    ],
                }
            ],
            "url_context": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "Fetch and analyze content from https://example.com",
                        }
                    ],
                    "tools": [{"type": "web_search_20250305", "name": "web_search"}],
                }
            ],
            "web_search": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "What are the latest developments in AI?",
                        }
                    ],
                    "tools": [{"type": "web_search_20250305", "name": "web_search"}],
                }
            ],
            "computer_use": [
                {
                    "messages": [{"role": "user", "content": "Take a screenshot"}],
                    "tools": [
                        {
                            "type": "computer_20241022",
                            "name": "computer",
                            "display_width_px": 1024,
                            "display_height_px": 768,
                            "display_number": 1,
                        }
                    ],
                }
            ],
        },
        "google": {
            "function_calling": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "What's the weather in San Francisco?",
                        }
                    ],
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "description": "Get current weather",
                                "parameters": {
                                    "type": "object",
                                    "properties": {
                                        "location": {
                                            "type": "string",
                                            "description": "City name",
                                        }
                                    },
                                    "required": ["location"],
                                },
                            },
                        }
                    ],
                }
            ],
            "code_execution": [
                {
                    "messages": [
                        {"role": "user", "content": "Calculate fibonacci(10)"}
                    ],
                    "tools": [{"code_execution": {}}],
                }
            ],
            "url_context": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "Fetch and summarize content from https://example.com",
                        }
                    ],
                    "tools": [{"googleSearch": {}}],
                }
            ],
            "web_search": [
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": "What are the latest developments in AI?",
                        }
                    ],
                    "tools": [{"googleSearch": {}}],
                }
            ],
        },
    }

    with open("tools.examples.json", "w") as f:
        json.dump(examples, f, indent=2)

    print("📝 Created tools.examples.json")
    return examples


if __name__ == "__main__":
    print("Generating tool documentation files...")
    generate_specifications()
    generate_examples()
    print("✅ Done! Files created: tools.specs.json, tools.examples.json")
