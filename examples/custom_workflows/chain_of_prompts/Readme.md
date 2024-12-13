# Workflow with a chain of prompts

This is the code for the workflow with a chain of prompts. You can find the tutorial [here](https://docs.agenta.ai/docs/custom-workflows/quick-start).

To get started:

1. Install Agenta:

```bash
pip install -U agenta
```

2. Add the environment variables:

```bash
export OPENAI_API_KEY=<your-openai-api-key>
```

3. Create the application:

```bash

agenta init
```

3. Serve the workflow:

```bash
agenta variant serve cop.py
```

You can now navigate to the playground to run the workflow, run evaluations, and monitor the performance.
