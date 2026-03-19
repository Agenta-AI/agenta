def _entry():
    return {
        "name": None,
        "description": None,
        "categories": None,
        "flags": None,
        "presets": [],
    }


CATALOG_REGISTRY = {
    "agenta": {
        "custom": {
            "trace": {"v0": _entry()},
            "hook": {"v0": _entry()},
            "code": {"v0": _entry()},
            "snippet": {"v0": _entry()},
        },
        "builtin": {
            "match": {"v0": _entry()},
            "llm": {"v0": _entry()},
            "chat": {"v0": _entry()},
            "completion": {"v0": _entry()},
            "echo": {"v0": _entry()},
            "auto_exact_match": {"v0": _entry()},
            "auto_regex_test": {"v0": _entry()},
            "field_match_test": {"v0": _entry()},
            "json_multi_field_match": {"v0": _entry()},
            "auto_webhook_test": {"v0": _entry()},
            "auto_custom_code_run": {"v0": _entry()},
            "auto_ai_critique": {"v0": _entry()},
            "auto_starts_with": {"v0": _entry()},
            "auto_ends_with": {"v0": _entry()},
            "auto_contains": {"v0": _entry()},
            "auto_contains_any": {"v0": _entry()},
            "auto_contains_all": {"v0": _entry()},
            "auto_contains_json": {"v0": _entry()},
            "auto_json_diff": {"v0": _entry()},
            "auto_levenshtein_distance": {"v0": _entry()},
            "auto_similarity_match": {"v0": _entry()},
            "auto_semantic_similarity": {"v0": _entry()},
        },
    }
}
