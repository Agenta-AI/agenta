# Workflow with a chain of prompts

This is the code for the workflow with a chain of prompts. You can find the tutorial [here](https://agenta.ai/docs/custom-workflows/quick-start).

To get started:

1. Create a new environment

```bash
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

2. Set the environment variables:

```bash
export OPENAI_API_KEY=<your-openai-api-key>
export AGENTA_API_KEY=<your-agenta-api-key>
```

3. Run the application:

```bash
python cop.py
```

The server will start at http://localhost:8000
You can connect it to Agenta directly to run the playground. To use evaluation, you need to make it accessible from the internet (using ngrok or any other tunneling service).

