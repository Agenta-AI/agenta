"""Acceptance: a WhatsApp number end to end, over HTTP, against a running stack.

Meta is replaced by the fake Graph API from the unit suite
(`unit/channels/whatsapp/fake_graph.py`), served where the stack's API can
reach it: the stack sets `WHATSAPP_GRAPH_API_URL` to the fake, and this suite
reads and scripts it at `AGENTA_TEST_WHATSAPP_FAKE_GRAPH_URL`. Without that
variable the suite skips, because a real Meta number is the only other way to
connect one.

Each case connects its own number through the real connect route with a
minted API key, binds a mock-harness agent (a real turn, no model call), and
posts Meta-shaped webhooks signed with the connection's app secret to the
public ingress: the GET verify handshake and signed POSTs. What the customer
would see is read back from the fake, which keeps every message Meta accepted.
"""

import hashlib
import hmac
import json
import os
import random
import time
from uuid import uuid4

import pytest
import requests

from utils.constants import BASE_TIMEOUT

pytestmark = pytest.mark.acceptance

FAKE_GRAPH_URL = os.getenv("AGENTA_TEST_WHATSAPP_FAKE_GRAPH_URL", "").rstrip("/")

if not FAKE_GRAPH_URL:
    pytest.skip(
        "AGENTA_TEST_WHATSAPP_FAKE_GRAPH_URL is not set: this deployment has no "
        "fake Graph API to connect a WhatsApp number against",
        allow_module_level=True,
    )

_ANSWER = "Your order 4411 shipped yesterday."


# --------------------------------------------------------------------------- #
# The fake Graph API and Meta-shaped webhooks
# --------------------------------------------------------------------------- #


def _fake_state():
    return requests.get(f"{FAKE_GRAPH_URL}/_fake/state", timeout=BASE_TIMEOUT).json()


def _fake(path, body):
    response = requests.post(f"{FAKE_GRAPH_URL}{path}", json=body, timeout=BASE_TIMEOUT)
    assert response.status_code == 200, response.text


def _sent_to(number, wa_id):
    return [
        m
        for m in _fake_state()["sent"]
        if m["phone_number_id"] == number["phone_number_id"] and m["to"] == wa_id
    ]


def _texts_to(number, wa_id):
    return [m["text"]["body"] for m in _sent_to(number, wa_id) if m["type"] == "text"]


def _wait_for(predicate, *, timeout=90.0, delay=1.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(delay)
    return predicate()


def _message(text, *, wa_id, message_id=None):
    return {
        "from": wa_id,
        "id": message_id or f"wamid.{uuid4().hex}",
        "timestamp": str(int(time.time())),
        "type": "text",
        "text": {"body": text},
    }


def _button_reply(token, *, wa_id):
    return {
        "from": wa_id,
        "id": f"wamid.{uuid4().hex}",
        "timestamp": str(int(time.time())),
        "type": "interactive",
        "interactive": {
            "type": "button_reply",
            "button_reply": {"id": token, "title": "Approve"},
        },
    }


def _body(number, *messages, name="Kerry Fisher"):
    by_customer = {}
    for message in messages:
        by_customer.setdefault(message["from"], []).append(message)
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "102290129340398",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "display_phone_number": "15550100000",
                                "phone_number_id": number["phone_number_id"],
                            },
                            "contacts": [{"profile": {"name": name}, "wa_id": wa_id}],
                            "messages": customer_messages,
                        },
                    }
                    for wa_id, customer_messages in by_customer.items()
                ],
            }
        ],
    }


def _post(api_url, payload, *, secret=None, signature=None):
    raw = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if signature is None and secret is not None:
        signature = (
            "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        )
    if signature:
        headers["X-Hub-Signature-256"] = signature
    return requests.post(
        f"{api_url}/channels/whatsapp/events/",
        data=raw,
        headers=headers,
        timeout=BASE_TIMEOUT,
    )


def _customer():
    return "1631555" + "".join(random.choices("0123456789", k=4))


# --------------------------------------------------------------------------- #
# Connecting a number to a mock-harness agent
# --------------------------------------------------------------------------- #


def _mock_agent(authed_api, behavior, **kwargs):
    slug = uuid4().hex[:8]
    response = authed_api(
        "POST",
        "/simple/applications/",
        json={
            "application": {
                "slug": f"whatsapp-{slug}",
                "name": f"WhatsApp mock agent {slug}",
                "data": {
                    "uri": "agenta:builtin:agent:v0",
                    "parameters": {
                        "agent": {
                            "harness": {
                                "kind": "mock",
                                "extras": {"behavior": behavior, "kwargs": kwargs},
                            },
                            "sandbox": {"kind": "local"},
                            "llm": {
                                "provider": "mock",
                                "model": "mock-1",
                                "connection": {"mode": "self_managed"},
                            },
                        }
                    },
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["application"]["revision_id"]


def _connect(authed_api, *, data=None, token=None):
    """A fresh number on the fake, connected through the real connect route."""

    number = {
        "phone_number_id": "1065" + "".join(random.choices("0123456789", k=11)),
        "access_token": f"EAA-{uuid4().hex}",
        "app_secret": f"app-secret-{uuid4().hex}",
    }
    _fake(
        "/_fake/numbers",
        {
            "phone_number_id": number["phone_number_id"],
            "token": number["access_token"],
        },
    )
    response = authed_api(
        "POST",
        "/channels/connections/",
        json={
            "connection": {
                "channel": "whatsapp",
                "data": {"phone_number_id": number["phone_number_id"], **(data or {})},
                "credentials": {
                    "access_token": token or number["access_token"],
                    "app_secret": number["app_secret"],
                },
            }
        },
    )
    return number, response


def _connect_agent(authed_api, behavior="reply", *, data=None, **kwargs):
    revision_id = _mock_agent(authed_api, behavior, **kwargs)
    number, response = _connect(authed_api, data=data)
    assert response.status_code == 200, response.text
    connection = response.json()["connection"]
    agent = authed_api(
        "POST",
        "/channels/agents/",
        json={
            "agent": {
                "connection_id": connection["id"],
                "slug": f"agent-{uuid4().hex[:8]}",
                "data": {"references": {"workflow_revision": {"id": revision_id}}},
            }
        },
    )
    assert agent.status_code == 200, agent.text
    marked = authed_api(
        "POST", f"/channels/agents/{agent.json()['agent']['id']}/default"
    )
    assert marked.status_code == 200, marked.text
    return number, connection


# --------------------------------------------------------------------------- #
# Connect and verify
# --------------------------------------------------------------------------- #


@pytest.mark.usefixtures("cls_account")
class TestWhatsAppConnect:
    def test_a_token_that_cannot_read_the_number_is_refused(self, authed_api):
        _, response = _connect(authed_api, token="EAA-not-this-numbers-token")

        assert 400 <= response.status_code < 500, response.text

    def test_connect_returns_the_webhook_details_and_no_secret(self, authed_api):
        number, response = _connect(authed_api)

        assert response.status_code == 200, response.text
        connection = response.json()["connection"]
        data = connection["data"]
        assert data["webhook_url"].endswith("/channels/whatsapp/events/")
        assert data["webhook_verify_token"].startswith(number["phone_number_id"] + ".")
        assert data["verified_name"] == "Bella Shoes"
        assert number["access_token"] not in response.text
        assert number["app_secret"] not in response.text

    def test_the_verify_handshake_echoes_only_for_the_issued_token(
        self, authed_api, cls_account
    ):
        number, response = _connect(authed_api)
        token = response.json()["connection"]["data"]["webhook_verify_token"]
        url = f"{cls_account['api_url']}/channels/whatsapp/events/"

        good = requests.get(
            url,
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": token,
                "hub.challenge": "1158201444",
            },
            timeout=BASE_TIMEOUT,
        )
        bad = requests.get(
            url,
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": f"{number['phone_number_id']}.guess",
                "hub.challenge": "1158201444",
            },
            timeout=BASE_TIMEOUT,
        )

        assert good.status_code == 200, good.text
        assert good.text == "1158201444"
        assert good.headers["content-type"].startswith("text/plain")
        assert bad.status_code == 403
        assert "1158201444" not in bad.text


# --------------------------------------------------------------------------- #
# Signed ingress and the conversation
# --------------------------------------------------------------------------- #


@pytest.mark.usefixtures("cls_account")
class TestWhatsAppConversation:
    def test_unsigned_and_forged_events_are_refused_and_not_stored(
        self, authed_api, cls_account
    ):
        number, connection = _connect_agent(authed_api, "reply", text=_ANSWER)
        wa_id = _customer()
        payload = _body(number, _message("hello", wa_id=wa_id))

        missing = _post(cls_account["api_url"], payload)
        forged = _post(cls_account["api_url"], payload, secret="attacker-secret")

        assert missing.status_code == 401
        assert forged.status_code == 401
        events = authed_api(
            "POST",
            "/channels/inbox/events/query",
            json={"event": {"connection_id": connection["id"]}},
        ).json()
        assert events["count"] == 0

    def test_a_message_gets_typing_then_only_the_answer(self, authed_api, cls_account):
        number, _ = _connect_agent(authed_api, "reply", text=_ANSWER)
        wa_id = _customer()
        message = _message("Hi, is my order 4411 shipped?", wa_id=wa_id)

        response = _post(
            cls_account["api_url"], _body(number, message), secret=number["app_secret"]
        )

        assert response.status_code == 202, response.text
        texts = _wait_for(lambda: _texts_to(number, wa_id))
        assert texts == [_ANSWER]
        typing = [
            t
            for t in _fake_state()["typing"]
            if t["phone_number_id"] == number["phone_number_id"]
        ]
        assert typing and typing[0]["message_id"] == message["id"]
        assert typing[0]["typing_indicator"] == {"type": "text"}

    def test_a_batched_body_answers_each_customer(self, authed_api, cls_account):
        number, _ = _connect_agent(authed_api, "reply", text=_ANSWER)
        first, second = _customer(), _customer()

        response = _post(
            cls_account["api_url"],
            _body(
                number,
                _message("question one", wa_id=first),
                _message("question two", wa_id=second),
            ),
            secret=number["app_secret"],
        )

        assert response.status_code == 202, response.text
        assert _wait_for(lambda: _texts_to(number, first)) == [_ANSWER]
        assert _wait_for(lambda: _texts_to(number, second)) == [_ANSWER]

    def test_an_approval_arrives_as_reply_buttons_and_a_tap_answers_it(
        self, authed_api, cls_account
    ):
        number, _ = _connect_agent(authed_api, "approval", tool="cancel_order")
        wa_id = _customer()

        _post(
            cls_account["api_url"],
            _body(number, _message("cancel my order", wa_id=wa_id)),
            secret=number["app_secret"],
        )

        def buttons():
            for message in _sent_to(number, wa_id):
                if message["type"] == "interactive":
                    return message["interactive"]
            return None

        interactive = _wait_for(buttons)
        assert interactive is not None, _sent_to(number, wa_id)
        assert interactive["type"] == "button"
        replies = [b["reply"] for b in interactive["action"]["buttons"]]
        assert [r["title"] for r in replies] == ["Approve", "Deny"]
        assert "Cancel order" in interactive["body"]["text"]

        before = len(_sent_to(number, wa_id))
        tapped = _post(
            cls_account["api_url"],
            _body(number, _button_reply(replies[0]["id"], wa_id=wa_id)),
            secret=number["app_secret"],
        )

        assert tapped.status_code == 202, tapped.text
        assert _wait_for(lambda: len(_sent_to(number, wa_id)) > before)

    def test_a_reply_meta_refuses_as_window_closed_is_held_then_sent(
        self, authed_api, cls_account
    ):
        number, connection = _connect_agent(authed_api, "reply", text=_ANSWER)
        wa_id = _customer()
        _fake(
            "/_fake/fail_next",
            {"code": 131047, "phone_number_id": number["phone_number_id"]},
        )

        _post(
            cls_account["api_url"],
            _body(number, _message("any news?", wa_id=wa_id)),
            secret=number["app_secret"],
        )

        def held():
            rows = authed_api(
                "POST",
                "/channels/outbox/events/query",
                json={"event": {"state": "held"}},
            ).json()["events"]
            return [r for r in rows if r["connection_id"] == connection["id"]]

        assert _wait_for(held), "the refused reply was not held"
        assert _texts_to(number, wa_id) == []

        _post(
            cls_account["api_url"],
            _body(number, _message("hello again", wa_id=wa_id)),
            secret=number["app_secret"],
        )

        # the held answer first, then the answer to the new message
        assert _wait_for(lambda: len(_texts_to(number, wa_id)) >= 2)
        assert _texts_to(number, wa_id) == [_ANSWER, _ANSWER]
        assert held() == []

    def test_a_permanent_meta_refusal_fails_the_reply_once_with_metas_error(
        self, authed_api, cls_account
    ):
        number, connection = _connect_agent(authed_api, "reply", text=_ANSWER)
        wa_id = _customer()
        _fake(
            "/_fake/fail_next",
            {
                "code": 100,
                "phone_number_id": number["phone_number_id"],
            },
        )

        _post(
            cls_account["api_url"],
            _body(number, _message("hello", wa_id=wa_id)),
            secret=number["app_secret"],
        )

        def refused():
            rows = authed_api(
                "POST",
                "/channels/outbox/events/query",
                json={"event": {"state": "failed"}},
            ).json()["events"]
            return [r for r in rows if r["connection_id"] == connection["id"]]

        [row] = _wait_for(refused)
        assert row["status"]["code"] == "delivery_refused"
        assert "Graph API error 100" in row["status"]["message"]
        assert number["access_token"] not in row["status"]["message"]
        time.sleep(40)  # past one stream redelivery: nothing is retried
        assert _texts_to(number, wa_id) == []
        assert len(refused()) == 1

    def test_stop_silences_the_number_until_start(self, authed_api, cls_account):
        number, _ = _connect_agent(authed_api, "reply", text=_ANSWER)
        wa_id = _customer()

        def send(text):
            response = _post(
                cls_account["api_url"],
                _body(number, _message(text, wa_id=wa_id)),
                secret=number["app_secret"],
            )
            assert response.status_code == 202, response.text

        send("STOP")
        confirmed = _wait_for(lambda: _texts_to(number, wa_id))
        assert len(confirmed) == 1 and "START" in confirmed[0]

        send("where is my order?")
        time.sleep(8)
        assert len(_texts_to(number, wa_id)) == 1

        send("START")
        assert _wait_for(lambda: len(_texts_to(number, wa_id)) == 2)
        send("where is my order?")
        assert _wait_for(lambda: _texts_to(number, wa_id)[-1] == _ANSWER)

    def test_an_archived_number_refuses_events_and_the_handshake(
        self, authed_api, cls_account
    ):
        number, connection = _connect_agent(authed_api, "reply", text=_ANSWER)
        token = connection["data"]["webhook_verify_token"]

        archived = authed_api(
            "POST", f"/channels/connections/{connection['id']}/archive"
        )
        assert archived.status_code == 200, archived.text

        wa_id = _customer()
        response = _post(
            cls_account["api_url"],
            _body(number, _message("hello", wa_id=wa_id)),
            secret=number["app_secret"],
        )
        handshake = requests.get(
            f"{cls_account['api_url']}/channels/whatsapp/events/",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": token,
                "hub.challenge": "1",
            },
            timeout=BASE_TIMEOUT,
        )

        assert response.status_code == 401
        assert handshake.status_code == 403
        time.sleep(5)
        assert _texts_to(number, wa_id) == []
