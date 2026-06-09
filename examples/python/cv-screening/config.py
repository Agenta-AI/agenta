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
## Role: IT Manager (mid-sized company, ~150 employees)

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

Evaluate the candidate's CV against this job specification. Score each area from 1 (very poor fit) to 5 (excellent fit):

- experience: depth and relevance of professional experience for this role
- technical_skills: match between the candidate's technical skills and the role
- leadership: people management, budget and vendor ownership
- education_certifications: relevant degrees and certifications

Then give a final classification:

- strong_match: meets all requirements; should be interviewed
- potential_match: meets most requirements or has closely transferable experience; worth a closer look
- no_match: does not meet the core requirements

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
            "scores": {
                "type": "object",
                "properties": {
                    "experience": {"type": "integer", "minimum": 1, "maximum": 5},
                    "technical_skills": {"type": "integer", "minimum": 1, "maximum": 5},
                    "leadership": {"type": "integer", "minimum": 1, "maximum": 5},
                    "education_certifications": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 5,
                    },
                },
                "required": [
                    "experience",
                    "technical_skills",
                    "leadership",
                    "education_certifications",
                ],
                "additionalProperties": False,
            },
            "matched_requirements": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Must-have requirements the candidate clearly meets",
            },
            "missing_requirements": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Must-have requirements the candidate does not meet or that are not evidenced in the CV",
            },
            "nice_to_haves": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Nice-to-have qualifications found in the CV",
            },
            "classification": {
                "type": "string",
                "enum": ["strong_match", "potential_match", "no_match"],
            },
            "reasoning": {
                "type": "string",
                "description": "Two or three sentences justifying the classification",
            },
        },
        "required": [
            "scores",
            "matched_requirements",
            "missing_requirements",
            "nice_to_haves",
            "classification",
            "reasoning",
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
