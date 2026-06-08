"""SDK-driven Agenta evals for the LangGraph vanilla runtime.

See ``design/evals-langgraph.md`` for the plan. The pieces:

- ``application.py`` wraps the LangGraph agent as an Agenta application and
  returns the answer. Instrumentation makes the run emit a full trace.
- ``tracing.py`` sets up Agenta and LangChain instrumentation, and reads tool
  calls back by walking the application trace.
- ``evaluators.py`` holds three evaluators: rubric correctness (LLM judge),
  tool usage (assert tools were or were not called), faithful pricing.
- ``testset.py`` holds 12 single-question test cases, each a list of assertions.
- ``run.py`` wires them together and runs ``aevaluate``.
"""
