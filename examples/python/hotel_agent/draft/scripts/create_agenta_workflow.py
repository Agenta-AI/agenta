# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx",
# ]
# ///
"""Create the hotel-concierge-workflow app in Agenta via the REST API.

Uses POST /api/simple/applications/ to create the app with:
- parameters: the actual config values
- schemas.parameters: a JSON Schema describing the config shape

This gives Agenta a schema for the parameters without needing a running
server or URI.

Usage:
    cd examples/python/hotel_agent/draft
    uv run scripts/create_agenta_workflow.py
"""

from __future__ import annotations

import os

import httpx

AGENTA_HOST = os.getenv("AGENTA_HOST", "http://144.76.237.122:8280")
AGENTA_API_KEY = os.environ["AGENTA_API_KEY"]

APP_SLUG = "hotel-agent-workflow"

# ---------------------------------------------------------------------------
# Parameters: the actual config values
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are the concierge agent for **The Agenta Grand Hotel**, a single-property,
~120-room hotel. Be concise, warm, and accurate. Always quote prices in USD.

# Identity & authentication

The current guest is identified by the `current_user_id` injected at runtime;
treat them as authenticated. For policy-only questions (search, prices,
amenities, FAQ), authentication is not required.

# When to use tools

Always call a tool rather than guessing. In particular:

- Pricing: call `quote_stay` before quoting any all-in number.
- Availability: call `search_availability` before suggesting specific options.
- Booking actions: ALWAYS confirm a `quote_stay` with the guest before
  `create_reservation`.
- Reservation modifications/cancellations: call `view_my_reservations` first
  to verify the booking exists and inspect its rate type and dates.
- Rationales / examples / amenities / neighborhood: call `answer_question`
  for KB context, but use the rules in this prompt as authoritative.
- Tier-sensitive answers (cutoffs, fee waivers): call `get_guest_profile` to
  confirm tier when it changes the answer.

Never invent a price, room id, reservation id, or service code.

# Hotel facts (authoritative)

- Check-in: 3pm local. Checkout: 11am local (modifiable per §In-stay services).
- Rate types:
  - **Flexible** — full cancel/modify before cutoff.
  - **Advance** — ~15% off; 50% future-stay credit on cancel; date-shift
    only on modify (no room-class change).
  - **Non-refundable** — ~25% off; no cancel, no modify; escalation only.

# Fees & taxes (always include in any all-in quote)

- Room rate × nights, per the rate type's discount.
- **Occupancy tax: 14%** on the room rate (not on resort fee).
- **Resort fee: $35/night**, mandatory. **Waived for Platinum.** Charged in
  full to Gold and Standard.
- **Pet fee: $100/stay per pet** (flat, not per night).
- Add-ons at posted prices.

A common failure is quoting room rate alone and surprising the guest. Don't
do that. The `quote_stay` tool returns an itemized breakdown — surface the
line items.

# Cancellation cutoff

| Tier | Cutoff before check-in |
|---|---|
| Standard | 24 hours |
| Gold | 6 hours |
| Platinum | 6 hours |

Inside the cutoff: refusal + offer escalation. Refund treatment by rate type:
Flexible = full cash refund; Advance = 50% future-stay credit; Non-refundable
= no refund (escalation only).

Cancellation must be initiated before the cutoff to qualify; if the guest
neither cancels nor checks in, see No-show below.

# No-show (auto-applied at 11:59pm local on check-in date)

- Flexible: first night charged; remaining nights released.
- Advance: first night charged in full; remaining nights → 50% future-stay credit.
- Non-refundable: full forfeit (all nights, no credit).

**ANY** override of a no-show charge requires escalation, regardless of
amount. The agent has zero authority here.

# Modifications

- Free if ≥ 48h before check-in; otherwise **$25 fee** (waived for Gold/Platinum).
- **Maximum 2 modifications per booking.** Beyond that → escalate.
- Date change cannot cross a peak/off-peak season boundary — must rebook.
- Advance rate cannot change room class — must rebook.
- Upgrade modification: charge difference (always allowed if available).
- Downgrade modification: refund the difference, **Flexible only**.

# Upgrades

- **Paid upgrade**: allowed any time inventory exists.
- **Complimentary upgrade**: Platinum only, **same-day** request, **one tier
  up only**, subject to availability. Offer it proactively when eligible —
  don't wait to be asked.

# In-stay services

| Service | Standard | Gold/Platinum |
|---|---|---|
| Late checkout to 1pm | Free | Free |
| Late checkout to 2pm | $25/hr after 1pm | Free |
| Late checkout 3-4pm | $25/hr | $25/hr (still capped at 4pm) |
| Housekeeping request | Free | Free |
| Wake-up call (max 1 active) | Free | Free |
| Room service | Menu prices | Menu prices |

# Pets

- Pet fee: $100/stay per pet (flat).
- Maximum **2 pets** per booking.
- Maximum weight per pet: **50 lbs**.
- Pet-friendly rooms are a *subset* of inventory — search/book must verify
  availability for pet-friendly rooms specifically.
- **Service animals**: always permitted. Accept the guest's declaration as
  authoritative — no documentation, no questions, no fee, no weight check.
- Refusing on weight/count: offer the kennel-partner referral.
- Refusing on pet-room availability: offer alternative dates or pet-friendly
  room types.

# Escalation triggers (hand off to a human)

- Refund or credit > **$200** requested.
- **ANY** no-show charge override requested (regardless of amount).
- Non-refundable rate being challenged on any grounds (illness, weather,
  bereavement) — humans can grant compassion exceptions; you cannot.
- Modification beyond the 2-cap.
- Complaints about another guest, staff conduct, or property damage.
- Guest explicitly asks for a human.
- You're unsure how policy applies — escalate, don't guess.

# How to refuse on policy grounds

When declining a request:

1. State *which* rule applies.
2. State the cutoff/limit numerically. ("24 hours before check-in", not
   "shortly before".)
3. Offer the closest deliverable alternative ("I can't refund this, but I
   can hold a 50% future-stay credit"; for pets, kennel-partner referral).
4. Offer escalation only if the guest pushes back — not by default.

# Tone

Concise. Avoid filler. No emojis. Don't say "Of course!" or "Absolutely!"
to start every reply. Don't surface internal tool names to the guest.\
"""

PARAMETERS = {
    "prompt": {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
        ],
        "template_format": "curly",
        "input_keys": None,
        "llm_config": {
            "model": "openai:gpt-4o-mini",
            "temperature": 1.0,
            "max_tokens": None,
            "top_p": None,
            "frequency_penalty": None,
            "presence_penalty": None,
        },
    },
    "grounding_template": (
        "# Runtime context\n"
        "- Current guest: {guest_name} (tier: {guest_tier}, id: {guest_id})\n"
        "- Today: {today}"
    ),
    "agent": {
        "framework": "pydantic-ai",
        "instrument": True,
        "deps": ["pms", "retriever", "clock"],
    },
    "tools": [
        {
            "name": "search_availability",
            "description": "Search available rooms by date range. Returns nightly base rate per option. Use quote_stay afterwards to get the all-in price including taxes/fees.",
            "category": "discovery",
            "parameters": {
                "check_in": {
                    "type": "string",
                    "format": "date",
                    "required": True,
                    "description": "ISO 8601 date (YYYY-MM-DD)",
                },
                "check_out": {
                    "type": "string",
                    "format": "date",
                    "required": True,
                    "description": "ISO 8601 date (YYYY-MM-DD)",
                },
                "guests": {"type": "integer", "required": True, "description": "Number of guests"},
                "room_type": {
                    "type": "string",
                    "required": False,
                    "description": "Filter by room type code",
                },
                "pet_friendly_only": {
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": "Only show pet-friendly rooms",
                },
            },
            "returns": "list[Offer] — room_type, rate_plan, nightly_rate, available_units",
        },
        {
            "name": "list_room_types",
            "description": "List every sellable room type with capacity, base rate, and tier rank.",
            "category": "discovery",
            "parameters": {},
            "returns": "list[RoomType] — code, name, description, base_capacity, max_capacity, base_nightly_rate, tier_rank",
        },
        {
            "name": "quote_stay",
            "description": "Get an itemized all-in quote (room + tax + resort fee + pet fee). Always quote before confirming a booking.",
            "category": "booking",
            "parameters": {
                "room_type": {"type": "string", "required": True},
                "rate_plan": {"type": "string", "required": True},
                "check_in": {"type": "string", "format": "date", "required": True},
                "check_out": {"type": "string", "format": "date", "required": True},
                "guests": {"type": "integer", "required": True},
                "num_pets": {"type": "integer", "required": False, "default": 0},
            },
            "returns": "Quote — room_type, rate_plan, check_in, check_out, guests, nights, lines[], total",
        },
        {
            "name": "create_reservation",
            "description": "Confirm and persist a booking. Only call after guest accepts the quote.",
            "category": "booking",
            "parameters": {
                "room_type": {"type": "string", "required": True},
                "rate_plan": {"type": "string", "required": True},
                "check_in": {"type": "string", "format": "date", "required": True},
                "check_out": {"type": "string", "format": "date", "required": True},
                "guests": {"type": "integer", "required": True},
                "num_pets": {"type": "integer", "required": False, "default": 0},
            },
            "returns": "Reservation — id, guest_id, room_type, rate_plan, dates, status, modification_count",
        },
        {
            "name": "view_my_reservations",
            "description": "List the current guest's reservations.",
            "category": "booking",
            "parameters": {
                "status": {
                    "type": "string",
                    "required": False,
                    "enum": ["confirmed", "cancelled", "no_show", "completed"],
                },
            },
            "returns": "list[Reservation]",
        },
        {
            "name": "modify_reservation",
            "description": "Patch an existing reservation. Increments modification_count.",
            "category": "booking",
            "parameters": {
                "reservation_id": {"type": "string", "required": True},
                "check_in": {"type": "string", "format": "date", "required": False},
                "check_out": {"type": "string", "format": "date", "required": False},
                "room_type": {"type": "string", "required": False},
                "rate_plan": {"type": "string", "required": False},
                "guests": {"type": "integer", "required": False},
                "num_pets": {"type": "integer", "required": False},
            },
            "returns": "Reservation (updated)",
        },
        {
            "name": "cancel_reservation",
            "description": "Cancel a reservation. Sets status=cancelled. Idempotent.",
            "category": "booking",
            "parameters": {
                "reservation_id": {"type": "string", "required": True},
            },
            "returns": "Reservation (cancelled)",
        },
        {
            "name": "request_service",
            "description": "File an in-stay service request (housekeeping, late checkout, etc.).",
            "category": "in_stay",
            "parameters": {
                "reservation_id": {"type": "string", "required": True},
                "service_code": {"type": "string", "required": True},
            },
            "returns": "ServiceCharge — id, reservation_id, service_code, description, amount, status",
        },
        {
            "name": "answer_question",
            "description": "Search the knowledge base (policy rationales, amenities, FAQ, neighborhood).",
            "category": "knowledge",
            "parameters": {
                "query": {"type": "string", "required": True},
                "k": {"type": "integer", "required": False, "default": 5},
            },
            "returns": "list[Chunk] — text passages from the knowledge base",
        },
        {
            "name": "get_guest_profile",
            "description": "Look up the current guest's profile (name, email, tier).",
            "category": "profile",
            "parameters": {},
            "returns": "Guest — id, email, first_name, last_name, tier",
        },
        {
            "name": "list_rate_plans",
            "description": "List active rate plans, optionally filtered by room type.",
            "category": "rates",
            "parameters": {
                "room_type": {"type": "string", "required": False},
            },
            "returns": "list[RatePlan] — code, name, rate_type, discount_pct",
        },
    ],
}

# ---------------------------------------------------------------------------
# JSON Schema: describes the shape of the parameters
# ---------------------------------------------------------------------------

TOOL_PARAM_SCHEMA = {
    "type": "object",
    "additionalProperties": {
        "type": "object",
        "properties": {
            "type": {"type": "string", "description": "JSON type: string, integer, boolean, etc."},
            "format": {"type": "string", "description": "Optional format hint, e.g. 'date'"},
            "required": {"type": "boolean"},
            "default": {},
            "description": {"type": "string"},
            "enum": {"type": "array", "items": {"type": "string"}},
        },
    },
    "description": "Map of parameter name to its type descriptor",
}

TOOL_SCHEMA = {
    "type": "object",
    "required": ["name", "description", "category", "parameters", "returns"],
    "properties": {
        "name": {"type": "string", "description": "Tool function name"},
        "description": {"type": "string", "description": "What the tool does and when to use it"},
        "category": {
            "type": "string",
            "enum": ["discovery", "booking", "in_stay", "knowledge", "profile", "rates"],
            "description": "Functional grouping",
        },
        "parameters": TOOL_PARAM_SCHEMA,
        "returns": {"type": "string", "description": "Return type description"},
    },
}

PARAMETERS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "HotelConciergeWorkflow",
    "description": "Full workflow configuration for the hotel concierge agent, including prompt, model config, tool definitions, and agent settings.",
    "type": "object",
    "required": ["prompt", "grounding_template", "agent", "tools"],
    "properties": {
        "prompt": {
            "type": "object",
            "description": "The primary system prompt and LLM configuration.",
            "required": ["messages", "llm_config"],
            "properties": {
                "messages": {
                    "type": "array",
                    "description": "Ordered list of chat messages (system, user, assistant).",
                    "items": {
                        "type": "object",
                        "required": ["role", "content"],
                        "properties": {
                            "role": {
                                "type": "string",
                                "enum": ["system", "user", "assistant"],
                            },
                            "content": {"type": "string"},
                        },
                    },
                },
                "template_format": {
                    "type": "string",
                    "enum": ["curly", "fstring", "jinja2"],
                    "default": "curly",
                    "description": "Variable substitution syntax.",
                },
                "input_keys": {
                    "type": ["array", "null"],
                    "items": {"type": "string"},
                    "description": "Expected template variables (for validation).",
                },
                "llm_config": {
                    "type": "object",
                    "description": "Model selection and generation parameters.",
                    "required": ["model"],
                    "properties": {
                        "model": {
                            "type": "string",
                            "description": "Model identifier, e.g. 'openai:gpt-4o-mini'",
                        },
                        "temperature": {"type": ["number", "null"], "minimum": 0, "maximum": 2},
                        "max_tokens": {"type": ["integer", "null"], "minimum": 1},
                        "top_p": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
                        "frequency_penalty": {
                            "type": ["number", "null"],
                            "minimum": -2,
                            "maximum": 2,
                        },
                        "presence_penalty": {
                            "type": ["number", "null"],
                            "minimum": -2,
                            "maximum": 2,
                        },
                    },
                },
            },
        },
        "grounding_template": {
            "type": "string",
            "description": "Dynamic per-request addendum injected as a second system prompt. Variables: {guest_name}, {guest_tier}, {guest_id}, {today}.",
        },
        "agent": {
            "type": "object",
            "description": "Agent framework and runtime settings.",
            "required": ["framework", "instrument", "deps"],
            "properties": {
                "framework": {
                    "type": "string",
                    "enum": ["pydantic-ai", "openai-agents", "claude-sdk", "langgraph"],
                    "description": "Which agent framework this config targets.",
                },
                "instrument": {
                    "type": "boolean",
                    "description": "Whether to enable built-in OTel instrumentation.",
                },
                "deps": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["pms", "retriever", "clock"]},
                    "description": "Injectable dependencies the agent requires.",
                },
            },
        },
        "tools": {
            "type": "array",
            "description": "The 11 tools available to the agent.",
            "items": TOOL_SCHEMA,
        },
    },
}

# ---------------------------------------------------------------------------
# Create the app
# ---------------------------------------------------------------------------


def main() -> None:
    client = httpx.Client(
        base_url=f"{AGENTA_HOST}/api",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"ApiKey {AGENTA_API_KEY}",
        },
        timeout=30,
    )

    revision_data = {
        "parameters": PARAMETERS,
        "schemas": {
            "parameters": PARAMETERS_SCHEMA,
        },
    }

    # Step 1: Create app via simple endpoint
    print(f"Creating app '{APP_SLUG}'...")
    resp = client.post(
        "/simple/applications/",
        json={
            "application": {
                "slug": APP_SLUG,
                "name": "Hotel Concierge Workflow",
                "description": "Full workflow config for the hotel concierge agent: prompt, model, tools, and agent settings.",
            }
        },
    )
    if resp.status_code == 409:
        print("  App already exists.")
    elif resp.status_code >= 400:
        print(f"  ERROR {resp.status_code}: {resp.text}")
        return
    else:
        print("  App created.")

    # Step 2: Resolve app + variant
    query_resp = client.post(
        "/applications/query",
        json={"application_refs": [{"slug": APP_SLUG}]},
    )
    query_resp.raise_for_status()
    app_id = query_resp.json()["applications"][0]["id"]

    var_resp = client.post(
        "/applications/variants/query",
        json={
            "application_refs": [{"id": app_id}],
            "include_archived": False,
            "windowing": {"limit": 10},
        },
    )
    var_resp.raise_for_status()
    variants = var_resp.json().get("application_variants", [])

    if variants:
        variant_id = variants[0]["id"]
        print(f"  Using variant {variants[0].get('slug', '?')} ({variant_id})")
    else:
        print("  Creating variant...")
        cv_resp = client.post(
            "/applications/variants/",
            json={
                "application_variant": {
                    "application_id": app_id,
                    "slug": "pydanticai-vanilla",
                    "name": "pydanticai-vanilla",
                }
            },
        )
        cv_resp.raise_for_status()
        variant_id = cv_resp.json()["application_variant"]["id"]

    # Step 3: Commit revision with parameters + schemas
    print("Committing revision with parameters and schema...")
    commit_resp = client.post(
        "/applications/revisions/commit",
        json={
            "application_revision_commit": {
                "application_variant_id": variant_id,
                "slug": "workflow-v1",
                "message": "Full workflow config: prompt, model, tools, agent settings, with JSON schema",
                "data": revision_data,
            }
        },
    )
    if commit_resp.status_code >= 400:
        print(f"  Commit error {commit_resp.status_code}: {commit_resp.text[:300]}")
        return
    result = commit_resp.json()
    rev = result.get("application_revision", {})
    rev_data = rev.get("data", {})
    print(f"  Committed revision (version {rev.get('version', '?')}).")
    print(f"  Parameters keys: {list(rev_data.get('parameters', {}).keys())}")
    print(f"  Schema present: {bool(rev_data.get('schemas', {}).get('parameters'))}")

    # Step 4: Verify by fetching back
    print("\nVerifying via GET /simple/applications/...")
    fetch_resp = client.get(f"/simple/applications/{app_id}")
    if fetch_resp.status_code == 200:
        data = fetch_resp.json().get("data", {})
        params = data.get("parameters", {})
        schemas = data.get("schemas", {})
        param_schema = schemas.get("parameters", {})
        print(f"  Parameters keys: {list(params.keys())}")
        print(f"  Tools count: {len(params.get('tools', []))}")
        print(f"  Model: {params.get('prompt', {}).get('llm_config', {}).get('model')}")
        print(f"  Schema title: {param_schema.get('title')}")
        print(f"  Schema properties: {list(param_schema.get('properties', {}).keys())}")
    else:
        print(f"  Fetch failed: {fetch_resp.status_code}: {fetch_resp.text[:200]}")

    print("\nDone.")


if __name__ == "__main__":
    main()
