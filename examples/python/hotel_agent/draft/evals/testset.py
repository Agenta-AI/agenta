"""Twelve single-question test cases for the LangGraph runtime.

Each case is a flat dict, i.e. a list of assertions about one turn:

- ``message`` / ``persona`` feed the application.
- ``rubrics`` are natural-language correctness checks (LLM-judged).
- ``expected_tools`` must all be called; ``forbidden_tools`` must not be.

Every case carries all four assertion fields (empty lists where N/A) so the
evaluators always receive their arguments. Cases are grounded in the seed data
(``core/db/seed_data.py``) and the policy embedded in the system prompt. The
agent's "today" is pinned to SEED_NOW = 2026-06-01.
"""

from __future__ import annotations

TESTCASES: list[dict] = [
    # 1. All-in quote, Standard tier. Resort fee must be included.
    {
        "message": (
            "How much would 2 nights in a Deluxe room on the Flexible rate cost "
            "for 2 guests, checking in 2026-06-20?"
        ),
        "persona": "guest_sarah",
        "rubrics": [
            "States a single all-in total price for the stay",
            "The price includes the 14% occupancy tax",
            "The price includes the $35/night resort fee",
            "Quotes the price in USD",
        ],
        "expected_tools": ["quote_stay"],
        "forbidden_tools": [],
    },
    # 2. All-in quote, Platinum. Resort fee waived.
    {
        "message": (
            "What's the all-in price for 2 nights in a Suite on the Flexible rate, "
            "2 guests, checking in 2026-06-20?"
        ),
        "persona": "guest_eve",
        "rubrics": [
            "States that the resort fee is waived because the guest is Platinum tier",
            "States an all-in total that includes the 14% occupancy tax",
        ],
        "expected_tools": ["quote_stay"],
        "forbidden_tools": [],
    },
    # 3. Pet fee pricing, Gold.
    {
        "message": (
            "I'd like to bring my dog. What's the total for 3 nights in a Family room "
            "on the Flexible rate, 2 guests and 1 pet, checking in 2026-06-25?"
        ),
        "persona": "guest_dan",
        "rubrics": [
            "Includes a $100 pet fee that is flat per stay, not per night",
            "States an all-in total covering room, tax, resort fee, and the pet fee",
        ],
        "expected_tools": ["quote_stay"],
        "forbidden_tools": [],
    },
    # 4. Cancellation refusal inside the Standard 24h cutoff.
    {
        "message": (
            "Please cancel my reservation res_bob_inside_cutoff and give me a full refund."
        ),
        "persona": "guest_bob",
        "rubrics": [
            "Refuses to cancel for a full refund",
            "States the 24-hour cancellation cutoff for Standard tier",
            "Does not invent an exception to the policy",
        ],
        "expected_tools": [],
        "forbidden_tools": ["cancel_reservation"],
    },
    # 5. Non-refundable challenge -> escalation, Gold.
    {
        "message": (
            "I've fallen ill and can't travel. Please refund my non-refundable suite "
            "booking res_carla_future_nonref."
        ),
        "persona": "guest_carla",
        "rubrics": [
            "Does not grant the refund itself",
            "Explains that the booking is on a non-refundable rate",
            "Offers to escalate to a human for a possible compassion exception",
        ],
        "expected_tools": [],
        "forbidden_tools": ["cancel_reservation"],
    },
    # 6. Cancellation allowed: Flexible, outside cutoff, Standard.
    {
        "message": "Please cancel reservation res_sarah_future_flex. I confirm I want to cancel.",
        "persona": "guest_sarah",
        "rubrics": [
            "Confirms the cancellation can proceed",
            "States that the Flexible rate qualifies for a full refund",
        ],
        "expected_tools": ["cancel_reservation"],
        "forbidden_tools": [],
    },
    # 7. Policy Q&A: cancellation cutoff, no write action.
    {
        "message": "How long before check-in can I cancel my booking for free?",
        "persona": "guest_grace",
        "rubrics": [
            "States the Standard-tier cancellation cutoff is 24 hours before check-in",
            "Does not claim to have cancelled or changed any booking",
        ],
        "expected_tools": [],
        "forbidden_tools": ["cancel_reservation", "create_reservation", "modify_reservation"],
    },
    # 8. Pet policy: weight and count limits.
    {
        "message": "Can I bring my two dogs? One of them weighs about 70 lbs.",
        "persona": "guest_frank",
        "rubrics": [
            "States the maximum weight per pet is 50 lbs",
            "Notes that the 70 lb dog exceeds the weight limit",
            "Confirms up to 2 pets are allowed per booking",
            "Offers the kennel-partner referral as an alternative",
        ],
        "expected_tools": [],
        "forbidden_tools": [],
    },
    # 9. Service animal exception.
    {
        "message": "I travel with a service animal. Are there any fees or weight limits?",
        "persona": "guest_grace",
        "rubrics": [
            "States that service animals are always permitted",
            "States there is no pet fee for a service animal",
            "States there is no weight limit or documentation requirement for a service animal",
        ],
        "expected_tools": [],
        "forbidden_tools": [],
    },
    # 10. Availability search / discovery.
    {
        "message": "What rooms do you have available for 2 guests from 2026-06-20 to 2026-06-22?",
        "persona": "guest_frank",
        "rubrics": [
            "Lists one or more specific available room options",
            "Does not invent room types or prices that were not returned by the search",
        ],
        "expected_tools": ["search_availability"],
        "forbidden_tools": [],
    },
    # 11. Complimentary upgrade policy, Platinum.
    {
        "message": "As a Platinum member, when can I get a complimentary room upgrade?",
        "persona": "guest_eve",
        "rubrics": [
            "States complimentary upgrades are for Platinum tier only",
            "States the upgrade is same-day and one tier up only",
            "States the upgrade is subject to availability",
        ],
        "expected_tools": [],
        "forbidden_tools": [],
    },
    # 12. In-stay late checkout, Platinum (free to 2pm).
    {
        "message": "I'm staying in the Presidential Suite right now. Can I check out at 2pm?",
        "persona": "guest_eve",
        "rubrics": [
            "States that late checkout to 2pm is free for Platinum tier",
            "Offers to arrange the late checkout",
        ],
        "expected_tools": [],
        "forbidden_tools": [],
    },
]
