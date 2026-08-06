"""Shared configuration for the CV screening example.

This module holds everything that defines the screening application:
the Agenta app/variant slugs, the job specification, the prompt
messages, and the JSON schema used for structured output.

`create_app.py` uses it to create the prompt in Agenta, and `app.py`
falls back to it if the app has not been created yet.
"""

APP_SLUG = "cv-screening"
VARIANT_SLUG = "default"
TESTSET_NAME = "CV Screening - IT Manager"

# The job specification lives inside the prompt so it can be edited,
# versioned, and A/B tested from the Agenta playground.
JOB_SPEC = """\
## Role: IT Manager (mid-sized German manufacturing company, ~150 employees)

### Requirements (must-have)
- 5+ years of hands-on IT experience (infrastructure, networking, or system administration)
- 2+ years leading or supervising an IT team
- Experience managing IT budgets and external vendors
- Experience administering Windows Server environments and Active Directory

### Nice-to-have
- Relevant certifications (PMP, ITIL, CCNA, Microsoft, CompTIA Security+)
- Cloud experience (AWS, Azure, or Microsoft 365 migrations)
- Security and compliance exposure (PCI DSS, ISO 27001, HIPAA)
- Bachelor's degree in Computer Science or Information Systems\
"""

SYSTEM_PROMPT = f"""\
You are an experienced technical recruiter screening CVs for the following position:

{JOB_SPEC}

Evaluate the candidate's CV against this job specification on two dimensions, then give an overall recommendation:

- tech_match: do the candidate's technical skills cover what the role needs?
- experience_match: do the years of experience, seniority, and leadership scope fit the role?
- overall_match: would you advance this candidate to an interview? This is a holistic judgment against the full job specification (including any requirement not covered by the two dimensions above, such as languages or location), not just a combination of the other two.

For each of the three, answer true or false and give a one-or-two-sentence reason. Also list any must-have requirements that are missing or not evidenced in the CV.

Base your evaluation only on what is written in the CV. Do not reward keyword stuffing: look for evidence such as responsibilities held, years of experience, and concrete accomplishments.\
"""

USER_PROMPT = """\
Evaluate the following CV:

{{cv}}\
"""

# JSON schema for the structured classification output. Using
# `strict: true` makes OpenAI guarantee the response matches the schema.
CLASSIFICATION_SCHEMA = {
    "name": "cv_classification",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "tech_match": {
                "type": "boolean",
                "description": "Do the candidate's technical skills cover what the role needs?",
            },
            "tech_reason": {
                "type": "string",
                "description": "One or two sentences justifying tech_match",
            },
            "experience_match": {
                "type": "boolean",
                "description": "Do the years of experience, seniority, and leadership scope fit the role?",
            },
            "experience_reason": {
                "type": "string",
                "description": "One or two sentences justifying experience_match",
            },
            "overall_match": {
                "type": "boolean",
                "description": "Holistic recommendation: advance this candidate to an interview?",
            },
            "overall_reason": {
                "type": "string",
                "description": "One or two sentences justifying overall_match",
            },
            "missing_requirements": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Must-have requirements the candidate does not meet or that are not evidenced in the CV",
            },
        },
        "required": [
            "tech_match",
            "tech_reason",
            "experience_match",
            "experience_reason",
            "overall_match",
            "overall_reason",
            "missing_requirements",
        ],
        "additionalProperties": False,
    },
}

PROMPT_CONFIG = {
    "prompt": {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT},
        ],
        "input_keys": ["cv"],
        "template_format": "curly",
        "llm_config": {
            "model": "gpt-4o-mini",
            "temperature": 0.2,
            "max_tokens": 1500,
            "response_format": {
                "type": "json_schema",
                "json_schema": CLASSIFICATION_SCHEMA,
            },
        },
    }
}
