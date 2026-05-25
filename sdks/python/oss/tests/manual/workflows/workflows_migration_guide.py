import os
import uuid
import json
import copy
import dotenv
import requests

import agenta as ag

dotenv.load_dotenv()


# GLOBALS

### 2024/2025 FORMATS

OLD_AGENTA_API_URL = os.getenv(
    "OLD_AGENTA_API_URL",
    "https://eu.cloud.agenta.ai/api",
)
OLD_AGENTA_SERVICES_URL = os.getenv(
    "OLD_AGENTA_SERVICES_URL",
    "https://eu.cloud.agenta.ai/services",
)
OLD_AGENTA_API_KEY = os.getenv("OLD_AGENTA_API_KEY")

#### COMPLETION

OLD_REFERENCES = {
    "application": {
        "id": os.getenv(
            "OLD_APPLICATION_ID",
            "019d8ae0-59db-7ea1-a606-aaba9d7e6dc8",
        ),
        "slug": os.getenv(
            "OLD_APPLICATION_SLUG",
            "my_app",
        ),
    },
    "application_variant": {
        # "id": os.getenv(
        #     "OLD_APPLICATION_VARIANT_ID",
        #     "",
        # ),
        "slug": os.getenv(
            "OLD_APPLICATION_VARIANT_SLUG",
            "default",
        ),
    },
    "application_revision": {
        # "id": os.getenv(
        #     "OLD_APPLICATION_REVISION_ID",
        #     "",
        # ),
        "version": os.getenv(
            "OLD_APPLICATION_REVISION_VERSION",
            "1",
        ),
    },
}

#### CHAT

OLD_REFERENCES = {
    "application": {
        "id": os.getenv(
            "OLD_APPLICATION_ID",
            "019d8b80-b4dd-7013-91da-4d807a37799a",
        ),
        "slug": os.getenv(
            "OLD_APPLICATION_SLUG",
            "my_chat",
        ),
    },
    "application_variant": {
        # "id": os.getenv(
        #     "OLD_APPLICATION_VARIANT_ID",
        #     "",
        # ),
        "slug": os.getenv(
            "OLD_APPLICATION_VARIANT_SLUG",
            "default",
        ),
    },
    "application_revision": {
        # "id": os.getenv(
        #     "OLD_APPLICATION_REVISION_ID",
        #     "",
        # ),
        "version": os.getenv(
            "OLD_APPLICATION_REVISION_VERSION",
            "1",
        ),
    },
}

### 2026 FORMATS

NEW_AGENTA_API_URL = os.getenv(
    "NEW_AGENTA_API_URL",
    # "https://preview.agenta.dev/api",
    "http://localhost/api",
)
NEW_AGENTA_SERVICES_URL = os.getenv(
    "NEW_AGENTA_SERVICES_URL",
    # "https://testing.preview.agenta.dev/services",
    "http://localhost/services",
)
NEW_AGENTA_API_KEY = os.getenv("NEW_AGENTA_API_KEY")

#### COMPLETION

NEW_REFERENCES = {
    "application": {
        "id": os.getenv(
            "NEW_APPLICATION_ID",
            "019d8ae2-f6ce-7fd0-b902-736382072f99",
        ),
        "slug": os.getenv(
            "NEW_APPLICATION_SLUG",
            "my_app",
        ),
    },
    # "application_variant": {
    #     # "id": os.getenv(
    #     #     "NEW_APPLICATION_VARIANT_ID",
    #     #     "",
    #     # ),
    #     "slug": os.getenv(
    #         "NEW_APPLICATION_VARIANT_SLUG",
    #         "my_app.default",
    #     ),
    # },
    # "application_revision": {
    #     # "id": os.getenv(
    #     #     "NEW_APPLICATION_REVISION_ID",
    #     #     "",
    #     # ),
    #     "version": os.getenv(
    #         "NEW_APPLICATION_REVISION_VERSION",
    #         "1",
    #     ),
    # },
    "environment": {
        "slug": os.getenv(
            "NEW_ENVIRONMENT_SLUG",
            "development",
        ),
    },
}

#### CHAT

# NEW_REFERENCES = {
#     "application": {
#         "id": os.getenv(
#             "NEW_APPLICATION_ID",
#             "019d8b9a-0ba9-7300-bd41-aa55d89b9aef",
#         ),
#         "slug": os.getenv(
#             "NEW_APPLICATION_SLUG",
#             "my_chat",
#         ),
#     },
#     "application_variant": {
#         # "id": os.getenv(
#         #     "NEW_APPLICATION_VARIANT_ID",
#         #     "",
#         # ),
#         "slug": os.getenv(
#             "NEW_APPLICATION_VARIANT_SLUG",
#             "default",
#         ),
#     },
#     "application_revision": {
#         # "id": os.getenv(
#         #     "NEW_APPLICATION_REVISION_ID",
#         #     "",
#         # ),
#         "version": os.getenv(
#             "NEW_APPLICATION_REVISION_VERSION",
#             "1",
#         ),
#     },
#     # "environment": {
#     #     "slug": os.getenv(
#     #         "NEW_ENVIRONMENT_SLUG",
#     #         "development",
#     #     ),
#     # },
# }


### ALL FORMATS

#### COMPLETION

SERVICE = "completion"

INPUTS = {
    "country": "Germany",
}
MESSAGES = None
PARAMETERS = {
    #     "prompt": {
    #         "llm_config": {"model": "gpt-4o-mini", "tools": []},
    #         "messages": [
    #             {
    #                 "role": "system",
    #                 "content": "You are an expert in geography",
    #             },
    #             {
    #                 "role": "user",
    #                 "content": "What is the capital of {{country}}?",
    #             },
    #         ],
    #         "template_format": "curly",
    #         "input_keys": ["country"],
    #     }
    # }
    #### CHAT
    # SERVICE = "chat"
    # INPUTS = {
    #     "context": "Respond with concise and accurate information.",
    # }
    # MESSAGES = [
    #     {
    #         "role": "user",
    #         "content": "Aloha!",
    #     }
    # ]
    # PARAMETERS = {
    "prompt": {
        "llm_config": {"model": "gpt-4o-mini", "tools": []},
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful customer service chatbot. Please help the user with their query.\nUse the following context if available:\n<context>{{context}}</context>",
            }
        ],
        "template_format": "curly",
        "input_keys": ["context"],
    }
}

# CALLING APPLICATIONS


def ref_value(references: dict, *keys, default=None):
    value = references or {}
    for key in keys:
        if not isinstance(value, dict):
            return default
        value = value.get(key)
        if value in (None, ""):
            return default
    return value


def compact(value):
    if isinstance(value, dict):
        cleaned = {
            key: compact(item) for key, item in value.items() if item is not None
        }
        return {key: item for key, item in cleaned.items() if item not in ({}, [])}
    if isinstance(value, list):
        return [compact(item) for item in value if item is not None]
    return value


def with_application_id(url: str, references: dict) -> str:
    application_id = ref_value(references, "application", "id")
    return f"{url}?application_id={application_id}" if application_id else url


def invoke_references(references: dict) -> dict:
    return compact(
        {
            "application": {
                "id": ref_value(references, "application", "id"),
                "slug": ref_value(references, "application", "slug"),
            },
            "application_variant": {
                "id": ref_value(references, "application_variant", "id"),
                "slug": ref_value(references, "application_variant", "slug"),
            },
            "application_revision": {
                "id": ref_value(references, "application_revision", "id"),
                "slug": ref_value(references, "application_revision", "slug"),
                "version": ref_value(references, "application_revision", "version"),
            },
            "environment": {
                "id": ref_value(references, "environment", "id"),
                "slug": ref_value(references, "environment", "slug"),
            },
            "environment_variant": {
                "id": ref_value(references, "environment_variant", "id"),
                "slug": ref_value(references, "environment_variant", "slug"),
            },
            "environment_revision": {
                "id": ref_value(references, "environment_revision", "id"),
                "slug": ref_value(references, "environment_revision", "slug"),
                "version": ref_value(references, "environment_revision", "version"),
            },
        }
    )


def selector_key(references: dict) -> str | None:
    key = ref_value(references, "selector", "key")
    if key:
        return key

    has_environment_refs = any(
        ref_value(references, ref_name, field)
        for ref_name in (
            "environment",
            "environment_variant",
            "environment_revision",
        )
        for field in ("id", "slug", "version")
    )
    has_application_revision_refs = any(
        ref_value(references, ref_name, field)
        for ref_name in ("application_variant", "application_revision")
        for field in ("id", "slug", "version")
    )
    application_slug = ref_value(references, "application", "slug")

    if has_environment_refs and not has_application_revision_refs and application_slug:
        return f"{application_slug}.revision"

    return None


def invoke_selector(references: dict) -> dict:
    return compact({"key": selector_key(references)})


def application_variant_slug(references: dict) -> str | None:
    slug = ref_value(references, "application_variant", "slug")
    app_slug = ref_value(references, "application", "slug")
    if slug and app_slug and slug.startswith(f"{app_slug}."):
        return slug.removeprefix(f"{app_slug}.")
    return slug


def legacy_reference_params(references: dict, *, app_prefers_id: bool = False) -> dict:
    variant_version = ref_value(references, "application_revision", "version")
    environment_version = ref_value(references, "environment_revision", "version")

    params = {
        "app": ref_value(
            references,
            "application",
            "id" if app_prefers_id else "slug",
        )
        or ref_value(
            references,
            "application",
            "slug" if app_prefers_id else "id",
        ),
        "variant_id": ref_value(references, "application_variant", "id"),
        "variant_slug": ref_value(references, "application_variant", "slug"),
        "variant_version": int(variant_version)
        if isinstance(variant_version, str) and variant_version.isdigit()
        else variant_version,
        "environment_id": ref_value(references, "environment", "id"),
        "environment_slug": ref_value(references, "environment", "slug"),
        "environment_version": int(environment_version)
        if isinstance(environment_version, str) and environment_version.isdigit()
        else environment_version,
        "key": selector_key(references),
    }
    return {key: value for key, value in params.items() if value is not None}


def call_application(
    url: str,
    headers: dict,
    params: dict,
) -> dict:
    response = requests.post(
        url,
        json=params,
        headers=headers,
        timeout=30,
    )

    status = response.status_code
    data = response.json()

    return status, data


def call_application_adapter(
    url: str,
    headers: dict,
    params: dict,
) -> dict:
    _data = {
        "inputs": {
            **(params.get("inputs") or {}),
            **({"messages": params.get("messages")} if SERVICE == "chat" else {}),
        },
        "parameters": params.get("ag_config"),
    }

    _references = {
        "application": {
            "id": params.get("app_id"),
            "slug": params.get("app"),
        },
        "application_variant": {
            "id": params.get("variant_id"),
            "slug": params.get("variant_slug"),
        },
        "application_revision": {
            "id": None,
            "slug": None,
            "version": str(params.get("variant_version"))
            if params.get("variant_version")
            else None,
        },
        "environment": {
            "id": params.get("environment_id"),
            "slug": params.get("environment_slug"),
        },
        "environment_variant": {
            "id": None,
            "slug": None,
        },
        "environment_revision": {
            "id": None,
            "slug": None,
            "version": str(params.get("environment_version"))
            if params.get("environment_version")
            else None,
        },
    }

    _references = {
        k: {_k: _v for _k, _v in v.items() if _v} for k, v in _references.items() if v
    }

    _references = {k: v for k, v in _references.items() if v}

    _selector = compact({"key": params.get("key") or params.get("selector_key")})

    _params = {
        "data": _data,
        "references": _references,
        "selector": _selector,
    }

    _params = {
        k: {_k: _v for _k, _v in v.items() if _v} for k, v in _params.items() if v
    }

    _params = {k: v for k, v in _params.items() if v}

    _url = f"{NEW_AGENTA_SERVICES_URL}/{SERVICE}/v0/invoke"

    response = requests.post(
        url=_url,
        json=_params,
        headers=headers,
        timeout=30,
    )

    status = response.status_code
    data = response.json()

    if status >= 400:
        return status, data, _url, _params

    outputs = (data.get("data") or {}).get("outputs")
    trace_id = data.get("trace_id")
    tree_id = str(uuid.UUID(trace_id)) if trace_id else None

    _data = {
        "version": "3.0",
        "data": outputs,
        "content_type": "text/plain"
        if isinstance(outputs, str)
        else "application/json",
        "tree": None,
        "tree_id": tree_id,
        "trace_id": trace_id,
        "span_id": data.get("span_id"),
    }

    return status, _data, _url, _params


def print_operation(
    url: str,
    headers: dict,
    params: dict,
    status: int,
    data: dict,
) -> None:
    url = copy.deepcopy(url)
    params = copy.deepcopy(params)
    data = copy.deepcopy(data)

    if OLD_AGENTA_SERVICES_URL in url:
        url = url.replace(OLD_AGENTA_SERVICES_URL, "{OLD_AGENTA_SERVICES_URL}")
    if NEW_AGENTA_SERVICES_URL in url:
        url = url.replace(NEW_AGENTA_SERVICES_URL, "{NEW_AGENTA_SERVICES_URL}")

    if "data" in params:
        if "inputs" in params["data"]:
            params["data"]["inputs"] = "<inputs>"
        if "parameters" in params["data"]:
            params["data"]["parameters"] = "<parameters>"
    if "inputs" in params:
        params["inputs"] = "<inputs>"
    if "ag_config" in params:
        params["ag_config"] = "<parameters>"

    if "tree" in data:
        data["tree"] = "<tree>"

    print()
    print("=" * 80)
    print(url)
    # print(json.dumps(headers, indent=4))
    print(json.dumps(params, indent=4))
    print()
    print(status)
    print(json.dumps(data, indent=4))
    print("=" * 80)
    print()


# ## USING DRAFT CONFIGURATIONS

# ### 2024 FORMAT


# def get_draft_request_in_2024_format(
#     services_url: str,
#     api_key: str,
#     references: dict,
# ) -> tuple[str, dict]:
#     url = with_application_id(f"{services_url}/{SERVICE}/generate", references)

#     headers = {
#         "Authorization": f"ApiKey {api_key}",
#         "Content-Type": "application/json",
#     }

#     params = {
#         "inputs": INPUTS,
#         "messages": MESSAGES,
#         "ag_config": PARAMETERS,
#     }

#     params = {k: v for k, v in params.items() if v is not None}

#     return url, headers, params


# url, headers, params = get_draft_request_in_2024_format(
#     services_url=OLD_AGENTA_SERVICES_URL,
#     api_key=OLD_AGENTA_API_KEY,
#     references=OLD_REFERENCES,
# )

# status, data = call_application(
#     url=url,
#     headers=headers,
#     params=params,
# )

# print_operation(
#     url=url,
#     headers=headers,
#     params=params,
#     status=status,
#     data=data,
# )

# ### 2025 FORMAT


# def get_draft_request_in_2025_format(
#     services_url: str,
#     api_key: str,
#     references: dict,
# ) -> tuple[str, dict]:
#     headers = {
#         "Authorization": f"ApiKey {api_key}",
#         "Content-Type": "application/json",
#     }
#     url = with_application_id(f"{services_url}/{SERVICE}/test", references)

#     headers = {
#         "Authorization": f"ApiKey {api_key}",
#         "Content-Type": "application/json",
#     }

#     params = {
#         "inputs": INPUTS,
#         "messages": MESSAGES,
#         "ag_config": PARAMETERS,
#     }

#     params = {k: v for k, v in params.items() if v is not None}

#     return url, headers, params


# url, headers, params = get_draft_request_in_2025_format(
#     services_url=OLD_AGENTA_SERVICES_URL,
#     api_key=OLD_AGENTA_API_KEY,
#     references=OLD_REFERENCES,
# )

# status, data = call_application(
#     url=url,
#     headers=headers,
#     params=params,
# )

# print_operation(
#     url=url,
#     headers=headers,
#     params=params,
#     status=status,
#     data=data,
# )

# ### 2026 FORMAT


def get_draft_request_in_2026_format(
    services_url: str,
    api_key: str,
    references: dict,
) -> tuple[str, dict]:
    url = f"{services_url}/{SERVICE}/v0/invoke"

    headers = {
        "Authorization": f"ApiKey {api_key}",
        "Content-Type": "application/json",
    }

    params = {
        "data": {
            "inputs": {**INPUTS, **{"messages": MESSAGES}}
            if SERVICE == "chat"
            else INPUTS,
            "parameters": PARAMETERS,
        },
        "references": invoke_references(references),
        "selector": invoke_selector(references),
    }

    params = {k: v for k, v in params.items() if v is not None}

    return url, headers, params


# url, headers, params = get_draft_request_in_2024_format(
#     services_url=NEW_AGENTA_SERVICES_URL,
#     api_key=NEW_AGENTA_API_KEY,
#     references=NEW_REFERENCES,
# )

# status, data = call_application(
#     url=url,
#     headers=headers,
#     params=params,
# )

# print_operation(
#     url=url,
#     headers=headers,
#     params=params,
#     status=status,
#     data=data,
# )

# _url, _params = url, params

# url, headers, params = get_draft_request_in_2026_format(
#     services_url=NEW_AGENTA_SERVICES_URL,
#     api_key=NEW_AGENTA_API_KEY,
#     references=NEW_REFERENCES,
# )

# status, data = call_application(
#     url=url,
#     headers=headers,
#     params=params,
# )

# print_operation(
#     url=url,
#     headers=headers,
#     params=params,
#     status=status,
#     data=data,
# )


# status, data, __url, __params = call_application_adapter(
#     url=_url,
#     headers=headers,
#     params=_params,
# )

# print_operation(
#     url=_url,
#     headers=headers,
#     params=_params,
#     status=status,
#     data=data,
# )


## USING COMMITTED CONFIGURATIONS


ag.init(
    api_url=NEW_AGENTA_API_URL,
    api_key=NEW_AGENTA_API_KEY,
)

print()

print("------------------------------------------------")

variant_slug = ref_value(NEW_REFERENCES, "application_variant", "slug")
environment_slug = "development"

if variant_slug:
    config = ag.ConfigManager.get_from_registry(
        app_slug=ref_value(NEW_REFERENCES, "application", "slug"),
        variant_slug="my_app.default",
        variant_version=2,
    )

    print(config)
    print("------------------------------------------------")

    config = ag.ConfigManager.get_from_registry(
        app_slug=ref_value(NEW_REFERENCES, "application", "slug"),
        variant_slug=variant_slug,
        variant_version=1,
    )

    print(config)
    print("------------------------------------------------")

config = ag.ConfigManager.get_from_registry(
    app_slug=ref_value(NEW_REFERENCES, "application", "slug"),
    environment_slug=ref_value(NEW_REFERENCES, "environment", "slug"),
)

print(config)
print("------------------------------------------------")

print()


# ### 2024 FORMAT


def get_committed_request_in_2024_format(
    services_url: str,
    api_key: str,
    references: dict,
) -> tuple[str, dict]:
    url = with_application_id(f"{services_url}/{SERVICE}/generate_deployed", references)

    headers = {
        "Authorization": f"ApiKey {api_key}",
        "Content-Type": "application/json",
    }

    params = {
        "inputs": INPUTS,
        "messages": MESSAGES,
        **legacy_reference_params(references),
    }

    params = {k: v for k, v in params.items() if v is not None}

    return url, headers, params


# url, headers, params = get_committed_request_in_2024_format(
#     services_url=OLD_AGENTA_SERVICES_URL,
#     api_key=OLD_AGENTA_API_KEY,
#     references=OLD_REFERENCES,
# )

# status, data = call_application(
#     url=url,
#     headers=headers,
#     params=params,
# )

# print_operation(
#     url=url,
#     headers=headers,
#     params=params,
#     status=status,
#     data=data,
# )

# ### 2025 FORMAT


def get_committed_request_in_2025_format(
    services_url: str,
    api_key: str,
    references: dict,
) -> tuple[str, dict]:
    url = with_application_id(f"{services_url}/{SERVICE}/run", references)

    headers = {
        "Authorization": f"ApiKey {api_key}",
        "Content-Type": "application/json",
    }

    params = {
        "inputs": INPUTS,
        "messages": MESSAGES,
        **legacy_reference_params(references, app_prefers_id=True),
    }

    params = {k: v for k, v in params.items() if v is not None}

    return url, headers, params


# url, headers, params = get_committed_request_in_2025_format(
#     services_url=OLD_AGENTA_SERVICES_URL,
#     api_key=OLD_AGENTA_API_KEY,
#     references=OLD_REFERENCES,
# )

# status, data = call_application(
#     url=url,
#     headers=headers,
#     params=params,
# )

# print_operation(
#     url=url,
#     headers=headers,
#     params=params,
#     status=status,
#     data=data,
# )

# ### 2026 FORMAT


def get_committed_request_in_2026_format(
    services_url: str,
    api_key: str,
    references: dict,
) -> tuple[str, dict]:
    url = f"{services_url}/{SERVICE}/v0/invoke"

    headers = {
        "Authorization": f"ApiKey {api_key}",
        "Content-Type": "application/json",
    }

    params = {
        "data": {
            "inputs": {**INPUTS, **{"messages": MESSAGES}}
            if SERVICE == "chat"
            else INPUTS
        },
        "references": invoke_references(references),
        "selector": invoke_selector(references),
    }

    params = {k: v for k, v in params.items() if v is not None}

    return url, headers, params


url, headers, params = get_committed_request_in_2024_format(
    services_url=NEW_AGENTA_SERVICES_URL,
    api_key=NEW_AGENTA_API_KEY,
    references=NEW_REFERENCES,
)

status, data = call_application(
    url=url,
    headers=headers,
    params=params,
)

print_operation(
    url=url,
    headers=headers,
    params=params,
    status=status,
    data=data,
)

_url, _params = url, params

url, headers, params = get_committed_request_in_2026_format(
    services_url=NEW_AGENTA_SERVICES_URL,
    api_key=NEW_AGENTA_API_KEY,
    references=NEW_REFERENCES,
)

status, data = call_application(
    url=url,
    headers=headers,
    params=params,
)

print_operation(
    url=url,
    headers=headers,
    params=params,
    status=status,
    data=data,
)

status, data, __url, __params = call_application_adapter(
    url=_url,
    headers=headers,
    params=_params,
)

print_operation(
    url=_url,
    headers=headers,
    params=_params,
    status=status,
    data=data,
)
