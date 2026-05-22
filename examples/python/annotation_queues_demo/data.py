"""Demo data: questions, doc snippets, and the mapping between them.

This drives the data we push into Agenta for the annotation queues video.
Doc snippets are drawn from real Agenta documentation so the "correct" answers
are unambiguously verifiable.
"""

# --- 10 doc snippets used as context for the support bot ---------------------

DOC_SNIPPETS: dict[str, str] = {
    "prompts_concepts": (
        "Prompts in Agenta are organized as applications. Each application has "
        "one or more variants, which work like Git branches and let you "
        "experiment with different configurations side by side. Every commit "
        "to a variant creates a new revision; revisions are immutable so you "
        "can always roll back. There are two kinds of applications: completion "
        "(single-turn prompts like classification or summarization) and chat "
        "(multi-turn conversations).\n\n"
        "To create a new variant in the UI, open the application, click the "
        "variant dropdown, and select 'Create new variant'. Give it a slug, "
        "pick the starting configuration, and you can immediately edit the "
        "prompt, change the model, or tweak temperature. Hit Commit to save "
        "your changes as a new revision. Model and temperature are set under "
        "the 'Configure' tab of the playground."
    ),
    "deployment": (
        "Agenta has three default environments: development, staging, and "
        "production. Each environment points to a single deployed revision at "
        "a time. To deploy a prompt to an environment, open the variant view, "
        "click the 'Deploy' button, pick the target environment from the "
        "dropdown, and confirm. The new revision is served immediately to any "
        "SDK call that requests that environment slug.\n\n"
        "To roll back, deploy an older revision the same way. You can see the "
        "deployment history per environment under the environment's history "
        "tab. Promoting from staging to production is exactly the same flow "
        "as deploying for the first time."
    ),
    "fetch_prompt_sdk": (
        "The Agenta SDK fetches deployed prompts by application slug and "
        "environment slug. Use ag.ConfigManager.get_from_registry("
        "app_slug='my-app', environment_slug='production'). The SDK returns "
        "the full prompt configuration: messages, model, temperature, and any "
        "other parameters you set. You can pass the result directly into any "
        "LLM client (OpenAI, LiteLLM, Anthropic) without rewriting your code.\n\n"
        "Find the API key on the Agenta dashboard under Settings → API Keys. "
        "Set it as the AGENTA_API_KEY environment variable (and AGENTA_HOST "
        "for self-hosted) before calling ag.init() in your app."
    ),
    "tracing": (
        "Agenta uses OpenTelemetry for tracing. After calling ag.init() in "
        "your code, any LLM call made through an instrumented client (OpenAI, "
        "Anthropic, LiteLLM, LangChain) is automatically captured as a span. "
        "You can also wrap any Python function with the @ag.instrument() "
        "decorator to record its inputs, outputs, latency, and any nested "
        "calls. The decorator works on both sync and async functions.\n\n"
        "Traces show up in the Observability view in the Agenta UI. You can "
        "filter by application, time range, status, latency, or any custom "
        "attribute you set on a span. Each trace shows the full call graph "
        "from the entry point down to the LLM call."
    ),
    "testsets": (
        "A test set in Agenta is a collection of test cases used as input for "
        "evaluation runs. Each test case is a row with input columns and "
        "optionally a ground truth column for the expected output. You can "
        "create a test set from the UI by clicking 'New test set' and adding "
        "rows manually, or you can upload a CSV file. Programmatically, the "
        "SDK exposes TestsetManager.create with a list of dicts.\n\n"
        "Test sets are versioned: every change creates a new revision so you "
        "can reproduce older evaluation runs. An evaluation run uses a test "
        "set as input, an application variant as the runnable, and one or "
        "more evaluators to score the outputs. Test sets and evaluation runs "
        "are two different things; the test set is the data, the run is the "
        "execution."
    ),
    "evaluators": (
        "Agenta supports several evaluator types: LLM-as-a-judge (use an LLM "
        "to score outputs), semantic similarity (compare embeddings), "
        "classification metrics (precision, recall, F1), regex match, exact "
        "match, custom Python evaluators, and webhook evaluators that call "
        "your own service. All evaluators live in the Evaluator Playground "
        "where you can author them, test them on sample inputs, and version "
        "them.\n\n"
        "Once an evaluator is defined, you can attach it to an evaluation run "
        "(automated scoring on a test set) or to an annotation queue (manual "
        "scoring by a human reviewer). To create an LLM-as-a-judge evaluator, "
        "go to the playground, pick the LLM-judge template, write your prompt "
        "with placeholders for inputs and outputs, and save."
    ),
    "human_evaluation": (
        "Human evaluation in Agenta lets reviewers score outputs manually "
        "using a schema you define. You create a human evaluator with fields "
        "such as ratings, dropdowns, free text, or yes/no questions. The same "
        "human evaluator can be attached to an evaluation run (score every "
        "row of a test set) or to an annotation queue.\n\n"
        "An annotation queue is a focused review surface: reviewers see one "
        "item at a time, score it with the fields you defined, and move on. "
        "All scores are stored on the trace or test case they refer to. QA "
        "engineers and SMEs can review production traces this way without "
        "needing to learn the rest of the product."
    ),
    "cost_tracking": (
        "Agenta records token usage and cost on every traced LLM call. Cost "
        "is computed from the model name and the token counts reported by "
        "the LLM provider, using the per-model rates Agenta maintains. You "
        "see per-request cost in the observability view, both as a number "
        "and as a column you can filter or sort by.\n\n"
        "For multi-step conversations, sessions and evaluation runs aggregate "
        "cost across all child spans. So you can see the total cost of a "
        "single user interaction even when it involves several LLM calls and "
        "retries. The cost numbers are calculated from real token counts, "
        "they are not estimates."
    ),
    "hosting": (
        "Agenta is available as a managed cloud service in the EU and US "
        "regions, and as a self-hosted option you run on your own "
        "infrastructure. The cloud version is hosted at cloud.agenta.ai for "
        "US customers and eu.cloud.agenta.ai for EU customers; data stays "
        "in-region.\n\n"
        "Self-hosting uses Docker Compose and ships with the same product "
        "features as cloud. Enterprise features like SSO and dedicated "
        "support are only available on the Business and Enterprise plans of "
        "cloud (and on the Enterprise self-hosted license)."
    ),
    "integrations": (
        "Agenta integrates with the LLM frameworks teams already use. "
        "LangChain, LlamaIndex, LiteLLM, the OpenAI SDK, and the Anthropic "
        "SDK all work out of the box: install the matching OpenTelemetry "
        "instrumentor and call ag.init(). The instrumentor catches LLM calls "
        "made through that library and traces them automatically.\n\n"
        "Agenta supports any model that runs through one of these clients, "
        "including OpenAI, Anthropic Claude, Google Gemini, Mistral, Cohere, "
        "and self-hosted models via LiteLLM. The SDK does not force you to "
        "wrap your code in Agenta-specific abstractions; it stays "
        "framework-agnostic."
    ),
}


# --- 15 test set questions (no ground truth, that gets added on camera) -------

TESTSET_QUESTIONS: list[dict] = [
    {"question": "How do I create a new prompt variant in Agenta?"},
    {"question": "How do I deploy a prompt to production?"},
    {"question": "How can I fetch a deployed prompt from the SDK?"},
    {"question": "How do I trace a function with the Python SDK?"},
    {"question": "What is a test set in Agenta?"},
    {"question": "What evaluator types does Agenta support?"},
    {"question": "How does human evaluation work in Agenta?"},
    {"question": "How does Agenta track LLM cost per request?"},
    {"question": "What is the difference between Agenta cloud and self-hosted?"},
    {"question": "Can I use Agenta with LangChain?"},
    {"question": "How are prompt versions managed in Agenta?"},
    {"question": "Where do I configure the model and temperature for a prompt?"},
    {"question": "How do annotation queues fit into the evaluation workflow?"},
    {"question": "What is the difference between a variant and a revision?"},
    {"question": "Can I see total cost across a multi-step conversation?"},
]


# --- question → correct doc snippet mapping ----------------------------------
# Index matches TESTSET_QUESTIONS. Used by the trace generator to pick the
# "correct" context for an invocation. For "unrelated" invocations the generator
# picks a different key from DOC_SNIPPETS.

CORRECT_DOC_FOR_QUESTION: list[str] = [
    "prompts_concepts",  # 1. create variant
    "deployment",  # 2. deploy to production
    "fetch_prompt_sdk",  # 3. fetch from SDK
    "tracing",  # 4. trace a function
    "testsets",  # 5. what is a test set
    "evaluators",  # 6. evaluator types
    "human_evaluation",  # 7. human evaluation
    "cost_tracking",  # 8. cost per request
    "hosting",  # 9. cloud vs self-hosted
    "integrations",  # 10. langchain
    "prompts_concepts",  # 11. prompt versioning (covered by concepts)
    "prompts_concepts",  # 12. configure model/temperature (covered by concepts)
    "human_evaluation",  # 13. annotation queues (partial coverage)
    "prompts_concepts",  # 14. variant vs revision
    "cost_tracking",  # 15. multi-step cost
]


# --- production trace questions (~30, mix of test set + variations) ----------

TRACE_QUESTIONS: list[dict] = [
    # First 15 mirror the test set so observability shows familiar questions
    *[
        {"question": q["question"], "correct_doc_key": k}
        for q, k in zip(TESTSET_QUESTIONS, CORRECT_DOC_FOR_QUESTION)
    ],
    # Additional production-style variations / rephrasings
    {
        "question": "I just made changes to my prompt, how do I save them as a new version?",
        "correct_doc_key": "prompts_concepts",
    },
    {
        "question": "Where do I find my API key to set AGENTA_API_KEY?",
        "correct_doc_key": "tracing",
    },
    {
        "question": "Does Agenta work with Anthropic Claude models?",
        "correct_doc_key": "integrations",
    },
    {
        "question": "Can I deploy to a staging environment before going to production?",
        "correct_doc_key": "deployment",
    },
    {"question": "How do I upload a CSV as a test set?", "correct_doc_key": "testsets"},
    {
        "question": "Is there a way to run an LLM-as-a-judge evaluator?",
        "correct_doc_key": "evaluators",
    },
    {
        "question": "Can my QA team review traces from production?",
        "correct_doc_key": "human_evaluation",
    },
    {
        "question": "How accurate are the cost numbers Agenta shows?",
        "correct_doc_key": "cost_tracking",
    },
    {
        "question": "Can I self-host Agenta on my own servers?",
        "correct_doc_key": "hosting",
    },
    {"question": "Does Agenta support LlamaIndex?", "correct_doc_key": "integrations"},
    {
        "question": "What gets stored when I commit a prompt change?",
        "correct_doc_key": "prompts_concepts",
    },
    {
        "question": "How do I revert a deployment to a previous revision?",
        "correct_doc_key": "deployment",
    },
    {
        "question": "Can I instrument a custom Python function for tracing?",
        "correct_doc_key": "tracing",
    },
    {
        "question": "Is there a difference between test sets and evaluation runs?",
        "correct_doc_key": "testsets",
    },
    {
        "question": "How are reviewer scores from human evaluation stored?",
        "correct_doc_key": "human_evaluation",
    },
]
