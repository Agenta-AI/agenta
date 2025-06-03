To run the manual observability tests:
- Create a .env file using .env.template as a template
- Run each of the scripts in the ingestion directory using:
```bash
uv run <script_name>.py
```

What to test:
- Did the ingestion work correctly (202 response)
- Do I see the ingested trace in the UI
- Does the ingested spans have the readable inputs and outputs (note that some agent spans do not have these, to check go to raw and look at the otel span attributes to see if there is something that should have been processed as input/output)
- Does the ingested spans have chat attributes shown as such
- Does the ingested spans show cost (correctly accumulated [note that for some like logfire, that is not possible due to batch processing]) or at least span cost/tokens