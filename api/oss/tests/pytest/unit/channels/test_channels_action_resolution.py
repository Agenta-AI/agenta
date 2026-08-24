"""`resolve_pending_choice`: the one function a click's token and a numbered
reply's position both go through. Pure, no DB — this is the whole mechanism
that makes ACTION portable across a rich payload and a plain-text one."""

from datetime import datetime, timezone

from oss.src.core.channels.dtos import ChannelPendingChoice, ChannelPendingChoiceItem
from oss.src.core.channels.service import resolve_pending_choice


def _choice(*pairs) -> ChannelPendingChoice:
    return ChannelPendingChoice(
        choices=[ChannelPendingChoiceItem(label=lbl, token=t) for lbl, t in pairs],
        posted_at=datetime.now(timezone.utc),
    )


def test_click_token_and_numbered_reply_resolve_to_the_same_value():
    """The whole design: a click carrying a token and a reply of "1"
    resolve to the identical value. Assert the equality directly."""

    pending = _choice(("Retry", "tok_retry"), ("Cancel", "tok_cancel"))

    from_click = resolve_pending_choice(pending_choice=pending, candidate="tok_retry")
    from_reply = resolve_pending_choice(pending_choice=pending, candidate="1")

    assert from_click == from_reply == "tok_retry"


def test_second_numbered_option_resolves_by_position():
    pending = _choice(("Retry", "tok_retry"), ("Cancel", "tok_cancel"))

    assert resolve_pending_choice(pending_choice=pending, candidate="2") == "tok_cancel"


def test_no_pending_choice_resolves_nothing():
    assert resolve_pending_choice(pending_choice=None, candidate="1") is None
    assert resolve_pending_choice(pending_choice=None, candidate="tok_retry") is None


def test_unknown_token_is_ignored_not_refused():
    pending = _choice(("Retry", "tok_retry"), ("Cancel", "tok_cancel"))

    assert resolve_pending_choice(pending_choice=pending, candidate="tok_bogus") is None


def test_out_of_range_number_is_ignored():
    pending = _choice(("Retry", "tok_retry"), ("Cancel", "tok_cancel"))

    assert resolve_pending_choice(pending_choice=pending, candidate="3") is None
    assert resolve_pending_choice(pending_choice=pending, candidate="0") is None


def test_ordinary_text_that_is_not_an_answer_resolves_nothing():
    pending = _choice(("Retry", "tok_retry"), ("Cancel", "tok_cancel"))

    assert (
        resolve_pending_choice(pending_choice=pending, candidate="hello there") is None
    )


def test_a_superseded_token_stops_resolving_once_a_newer_choice_replaces_it():
    """Supersession is wholesale replacement: the old choice's own token is
    simply no longer present in the field a newer post overwrote."""

    old_choice = _choice(("Retry", "tok_retry"), ("Cancel", "tok_cancel"))
    new_choice = _choice(("Yes", "tok_yes"), ("No", "tok_no"))

    # the stale token from the superseded (old) choice, checked against the
    # thread's CURRENT (new) pending choice -- an hour-old "1" must not
    # answer a question that has already moved on.
    assert resolve_pending_choice(pending_choice=old_choice, candidate="tok_retry") == (
        "tok_retry"
    )
    assert (
        resolve_pending_choice(pending_choice=new_choice, candidate="tok_retry") is None
    )
    assert resolve_pending_choice(pending_choice=new_choice, candidate="1") == "tok_yes"
