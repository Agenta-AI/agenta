# Agenta Scripts

This directory contains utility scripts for working with Agenta.

## create_variant.py

Create new variants in your Agenta deployment with custom prompt configurations.

### Installation

No installation needed! The script uses `uv run` with inline dependencies.

### Usage

#### Basic Example

Create a variant from a prompt configuration file:
```bash
uv run scripts/create_variant.py \
  --app-slug contract-review-indemnities-lol \
  --variant-slug indemnity-gpt5 \
  --prompt-file indemnity-query.json
```

This will:
1. Create a new variant with the specified slug
2. Commit the prompt configuration from the JSON file to the variant

#### Prompt File Format

The prompt file should be a JSON file with the following structure:
```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are an assistant..."
    },
    {
      "role": "user",
      "content": "Review this: {{input}}"
    }
  ],
  "template_format": "curly",
  "llm_config": {
    "model": "gpt-5",
    "temperature": 0.2,
    "max_tokens": 64000,
    "top_p": 1,
    "frequency_penalty": 0,
    "presence_penalty": 0
  },
  "input_keys": ["input"]
}
```

### Configuration

The script uses the same configuration as `get_prompt.py`:

#### Environment Variables

The script automatically loads environment variables from `scripts/.env`:

- `AGENTA_API_URL`: Agenta API URL (default: `https://agenta.bravetech.io`)
- `AGENTA_BRAVETECH_API_KEY`: Agenta API key (loaded from `scripts/.env`)
- `AGENTA_API_KEY`: Alternative API key variable

### Command-Line Arguments

```
Required Arguments:
  --app-slug          Application slug (e.g., contract-review-indemnities-lol)
  --variant-slug      Variant slug/name (e.g., indemnity-gpt5)
  --prompt-file       Path to JSON file containing prompt configuration

Optional Arguments:
  --api-url           Agenta API URL (default: $AGENTA_API_URL or https://agenta.bravetech.io)
  --api-key           Agenta API key (default: $AGENTA_BRAVETECH_API_KEY or $AGENTA_API_KEY)
  --project-id        Optional project ID filter
  --help              Show help message
```

### Example Workflow

1. Export a prompt configuration to a JSON file (or create one manually)
2. Create a new variant using the configuration:
```bash
uv run scripts/create_variant.py \
  --app-slug my-app \
  --variant-slug my-new-variant \
  --prompt-file my-prompt.json
```

### Troubleshooting

#### API Errors

If you get API errors:
1. Check that the app slug is correct
2. Ensure the variant slug doesn't already exist (or use a different name)
3. Verify your API key is set correctly in `scripts/.env`
4. Check that the prompt file format is correct

---

## get_prompt.py

Retrieve prompt configurations from your Agenta deployment.

### Installation

No installation needed! The script uses `uv run` with inline dependencies.

### Usage

#### Basic Examples

Get production prompt by app slug:
```bash
uv run scripts/get_prompt.py --environment production --app-slug indemnity-iol-review-clause
```

Get staging prompt by app ID:
```bash
uv run scripts/get_prompt.py --environment staging --app-id 019a0b13-7dac-7190-affa-e54d3a5a40d6
```

Get production prompt with revision history:
```bash
uv run scripts/get_prompt.py --environment production --app-slug my-app --include-revisions
```

Save output to file:
```bash
uv run scripts/get_prompt.py --environment production --app-slug my-app --output prompt.json
```

#### Using Your Deployment

For your specific deployment at `https://agenta.bravetech.io`:

```bash
# Using app ID (from your screenshot)
uv run scripts/get_prompt.py \
  --environment production \
  --app-id 019a0b13-7dac-7190-affa-e54d3a5a40d6 \
  --api-url https://agenta.bravetech.io

# Using app slug
uv run scripts/get_prompt.py \
  --environment production \
  --app-slug indemnity-iol-review-clause \
  --api-url https://agenta.bravetech.io
```

### Configuration

The script can be configured via command-line arguments or environment variables:

#### Environment Variables

The script automatically loads environment variables from `scripts/.env`:

- `AGENTA_API_URL`: Agenta API URL (default: `https://agenta.bravetech.io`)
- `AGENTA_BRAVETECH_API_KEY`: Agenta API key (loaded from `scripts/.env`)
- `AGENTA_API_KEY`: Alternative API key variable

**Setup `scripts/.env`:**
```bash
# Create or edit scripts/.env
echo "AGENTA_BRAVETECH_API_KEY=your_api_key_here" > scripts/.env
```

Then simply run:
```bash
uv run scripts/get_prompt.py --environment production --app-slug my-app
```

### Command-Line Arguments

```
Required Arguments:
  --environment, -e    Environment name (production, staging, development)
  --app-id            Application ID (e.g., 019a0b13-7dac-7190-affa-e54d3a5a40d6)
                      OR
  --app-slug          Application slug (e.g., indemnity-iol-review-clause)

Optional Arguments:
  --api-url           Agenta API URL (default: $AGENTA_API_URL or https://agenta.bravetech.io)
  --api-key           Agenta API key (default: $AGENTA_API_KEY)
  --include-revisions Include revision history in output
  --output, -o        Output file path (default: stdout)
  --pretty            Pretty-print JSON (default: True)
  --compact           Compact JSON output
  --help              Show help message
```

### Output Format

The script returns a JSON object containing:

```json
{
  "app_id": "019a0b13-7dac-7190-affa-e54d3a5a40d6",
  "environment": "production",
  "variant": {
    "variant_id": "...",
    "variant_name": "...",
    "parameters": {
      "prompt": {
        "messages": [...],
        "llm_config": {...}
      }
    }
  },
  "revisions": [...]  // Only if --include-revisions is used
}
```

### Troubleshooting

#### Connection Errors

If you get connection errors, check:
1. The API URL is correct
2. Your server is running: `ssh root@91.98.229.196 "docker ps"`
3. DNS is resolving correctly: `dig agenta.bravetech.io +short`

#### Authentication Errors

If you get 401/403 errors:
1. Check if your deployment requires an API key
2. Set the `AGENTA_API_KEY` environment variable or use `--api-key`

#### No Variant Deployed

If you get "No variant deployed to environment 'production'":
1. Check the Agenta UI to ensure a variant is deployed to that environment
2. Verify the environment name is correct (case-sensitive)

### Example Output

```bash
$ uv run scripts/get_prompt.py --environment production --app-slug indemnity-iol-review-clause
{
  "app_id": "019a0b13-7dac-7190-affa-e54d3a5a40d6",
  "environment": "production",
  "variant": {
    "variant_id": "019a0b45-cd43-7f70-9b96-42c03171c639",
    "variant_name": "gpt-5",
    "parameters": {
      "prompt": {
        "messages": [
          {
            "role": "system",
            "content": "You are an assistant..."
          }
        ],
        "llm_config": {
          "model": "gpt-4",
          "temperature": 0.7
        }
      }
    }
  }
}
```
