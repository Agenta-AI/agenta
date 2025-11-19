"""
Test script to understand how litellm expects file formats for different providers
"""
import base64
import os
import requests
from litellm import completion
from litellm.utils import supports_pdf_input

# API Keys
OPENAI_API_KEY = ""
ANTHROPIC_API_KEY = ""

# Download a test PDF
print("Downloading test PDF...")
pdf_url = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
response = requests.get(pdf_url)
pdf_bytes = response.content
pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")
pdf_base64_url = f"data:application/pdf;base64,{pdf_base64}"

print(f"PDF downloaded: {len(pdf_bytes)} bytes")
print(f"Base64 length: {len(pdf_base64)} characters")
print(f"Base64 URL length: {len(pdf_base64_url)} characters")
print("\n" + "="*80 + "\n")

# Test configurations
tests = [
    {
        "name": "OpenAI with file_data (base64 data URL)",
        "model": "gpt-4o",
        "api_key": OPENAI_API_KEY,
        "content": [
            {"type": "text", "text": "What's this file about?"},
            {
                "type": "file",
                "file": {
                    "file_data": pdf_base64_url,
                }
            },
        ],
    },
    {
        "name": "OpenAI with file_data + filename",
        "model": "gpt-4o",
        "api_key": OPENAI_API_KEY,
        "content": [
            {"type": "text", "text": "What's this file about?"},
            {
                "type": "file",
                "file": {
                    "file_data": pdf_base64_url,
                    "filename": "dummy.pdf",
                }
            },
        ],
    },
    {
        "name": "OpenAI with file_id (URL)",
        "model": "gpt-4o",
        "api_key": OPENAI_API_KEY,
        "content": [
            {"type": "text", "text": "What's this file about?"},
            {
                "type": "file",
                "file": {
                    "file_id": pdf_url,
                }
            },
        ],
    },
    {
        "name": "OpenAI with file_id (base64 URL) - WRONG WAY",
        "model": "gpt-4o",
        "api_key": OPENAI_API_KEY,
        "content": [
            {"type": "text", "text": "What's this file about?"},
            {
                "type": "file",
                "file": {
                    "file_id": pdf_base64_url,  # THIS IS WHAT'S CURRENTLY BEING SENT
                }
            },
        ],
    },
    {
        "name": "Anthropic with file_data (base64 data URL)",
        "model": "anthropic/claude-haiku-4-5",
        "api_key": ANTHROPIC_API_KEY,
        "content": [
            {"type": "text", "text": "What's this file about?"},
            {
                "type": "file",
                "file": {
                    "file_data": pdf_base64_url,
                }
            },
        ],
    },
    {
        "name": "Anthropic with file_data + format",
        "model": "anthropic/claude-haiku-4-5",
        "api_key": ANTHROPIC_API_KEY,
        "content": [
            {"type": "text", "text": "What's this file about?"},
            {
                "type": "file",
                "file": {
                    "file_data": pdf_base64_url,
                    "format": "application/pdf",
                }
            },
        ],
    },
    {
        "name": "Anthropic with file_id (URL)",
        "model": "anthropic/claude-haiku-4-5",
        "api_key": ANTHROPIC_API_KEY,
        "content": [
            {"type": "text", "text": "What's this file about?"},
            {
                "type": "file",
                "file": {
                    "file_id": pdf_url,
                }
            },
        ],
    },
    {
        "name": "Anthropic with file_id (base64 URL) - WRONG WAY",
        "model": "anthropic/claude-haiku-4-5",
        "api_key": ANTHROPIC_API_KEY,
        "content": [
            {"type": "text", "text": "What's this file about?"},
            {
                "type": "file",
                "file": {
                    "file_id": pdf_base64_url,  # THIS IS WHAT'S CURRENTLY BEING SENT
                }
            },
        ],
    },
]

# Run tests
results = []

for test in tests:
    print("="*80)
    print(f"TEST: {test['name']}")
    print("="*80)
    print(f"Model: {test['model']}")
    print(f"Supports PDF: {supports_pdf_input(test['model'], None)}")
    print(f"\nMessage structure:")
    print(f"  - Text: {test['content'][0]}")
    print(f"  - File keys: {list(test['content'][1]['file'].keys())}")
    
    for key, value in test['content'][1]['file'].items():
        if isinstance(value, str) and len(value) > 100:
            print(f"    {key}: {value[:50]}...{value[-30:]} (length: {len(value)})")
        else:
            print(f"    {key}: {value}")
    
    print("\nExecuting...")
    
    try:
        response = completion(
            model=test['model'],
            messages=[{"role": "user", "content": test['content']}],
            api_key=test['api_key'],
        )
        
        result = {
            "test": test['name'],
            "status": "SUCCESS",
            "response": response.choices[0].message.content[:200] if response.choices[0].message.content else None,
        }
        print(f"\n✓ SUCCESS")
        print(f"Response preview: {result['response']}...")
        
    except Exception as e:
        result = {
            "test": test['name'],
            "status": "FAILED",
            "error": str(e),
            "error_type": type(e).__name__,
        }
        print(f"\n✗ FAILED")
        print(f"Error type: {result['error_type']}")
        print(f"Error: {result['error'][:500]}")
    
    results.append(result)
    print("\n")

# Summary Report
print("\n" + "="*80)
print("SUMMARY REPORT")
print("="*80 + "\n")

print("OpenAI Results:")
print("-" * 40)
for result in results[:4]:
    status_symbol = "✓" if result['status'] == "SUCCESS" else "✗"
    print(f"{status_symbol} {result['test']}")
    if result['status'] == "FAILED":
        print(f"  Error: {result['error'][:100]}...")

print("\nAnthropic Results:")
print("-" * 40)
for result in results[4:]:
    status_symbol = "✓" if result['status'] == "SUCCESS" else "✗"
    print(f"{status_symbol} {result['test']}")
    if result['status'] == "FAILED":
        print(f"  Error: {result['error'][:100]}...")

print("\n" + "="*80)
print("CONCLUSIONS:")
print("="*80)

# Analyze patterns
openai_success = [r for r in results[:4] if r['status'] == "SUCCESS"]
anthropic_success = [r for r in results[4:] if r['status'] == "SUCCESS"]

if openai_success:
    print(f"\nOpenAI accepts:")
    for r in openai_success:
        print(f"  - {r['test'].split('OpenAI with ')[1]}")
else:
    print("\nOpenAI: No successful formats found!")

if anthropic_success:
    print(f"\nAnthropic accepts:")
    for r in anthropic_success:
        print(f"  - {r['test'].split('Anthropic with ')[1]}")
else:
    print("\nAnthropic: No successful formats found!")

print("\n" + "="*80)

