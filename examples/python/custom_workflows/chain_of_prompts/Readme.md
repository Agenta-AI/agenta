# Chain of Prompts

A custom workflow that chains two prompts: summarize a blog post, then write a tweet from the summary.

See the full tutorial: [Custom Workflows Quick Start](https://docs.agenta.ai/custom-workflows/quick-start)

## Setup

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

3. Start the server:

```bash
uvicorn main:application --host 0.0.0.0 --port 8000 --reload
```

4. Expose with ngrok:

```bash
ngrok http 8000
```

5. In Agenta, create a new custom workflow application and provide the ngrok URL.

## Files

- `app.py` - Workflow code with Agenta decorators
- `main.py` - Entry point for uvicorn
- `requirements.txt` - Dependencies
- `.env.example` - Environment variables template
