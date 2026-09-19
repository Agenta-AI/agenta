"""A 404 carrying an HTML page is the edge, not the services app, so the call is retried.

The retry helper was written for the 502 a gateway returns while it races a cutover. The
same cutover has another shape: the request is routed away from the services app instead
of erroring, and whatever else owns the shared host answers it with an HTML page and a
404. One stage run lost seven cases to that while the same commit passed on another stage,
and every route involved answered normally minutes later.

The distinction the helper has to keep is between that and a route which genuinely does
not exist. The services app speaks JSON throughout, including in its own 404s, so the body
settles it: HTML means the request never arrived, JSON means it did and the answer is no.
"""

import pytest

from utils.api import _request_with_gateway_retry


class _Response:
    def __init__(self, status_code: int, *, content_type: str = "", text: str = ""):
        self.status_code = status_code
        self.headers = {"content-type": content_type} if content_type else {}
        self.text = text


def _answering(*responses):
    """A request function that returns the given responses in order, and counts calls."""
    calls = []

    def _request(**kwargs):
        calls.append(kwargs)
        return responses[min(len(calls) - 1, len(responses) - 1)]

    return _request, calls


@pytest.fixture(autouse=True)
def _no_waiting(monkeypatch):
    """The delay between attempts is not what these assert, and it costs six seconds."""
    monkeypatch.setattr("utils.api.time.sleep", lambda _seconds: None)


_NEXT_PAGE = '<!DOCTYPE html><html lang="en"><head><title>Agenta</title></head></html>'


def test_an_html_404_is_retried_until_the_services_app_answers():
    ok = _Response(200, content_type="application/json", text="{}")
    request_fn, calls = _answering(
        _Response(404, content_type="text/html; charset=utf-8", text=_NEXT_PAGE),
        ok,
    )

    response = _request_with_gateway_retry(request_fn, method="POST", url="/inspect")

    assert response is ok
    assert len(calls) == 2


def test_an_html_404_without_a_content_type_is_read_from_its_body():
    ok = _Response(200, content_type="application/json", text="{}")
    request_fn, calls = _answering(_Response(404, text=_NEXT_PAGE), ok)

    response = _request_with_gateway_retry(request_fn, method="POST", url="/inspect")

    assert response is ok
    assert len(calls) == 2


def test_a_json_404_is_the_services_app_saying_no_and_is_not_retried():
    refusal = _Response(
        404, content_type="application/json", text='{"detail":"Not Found"}'
    )
    request_fn, calls = _answering(refusal)

    response = _request_with_gateway_retry(request_fn, method="POST", url="/nope")

    assert response is refusal
    assert len(calls) == 1


def test_an_html_404_that_never_clears_is_returned_rather_than_retried_forever():
    page = _Response(404, content_type="text/html", text=_NEXT_PAGE)
    request_fn, calls = _answering(page)

    response = _request_with_gateway_retry(request_fn, method="POST", url="/inspect")

    assert response is page
    assert len(calls) == 4


def test_a_gateway_error_is_still_retried():
    ok = _Response(200, content_type="application/json", text="{}")
    request_fn, calls = _answering(_Response(502), ok)

    response = _request_with_gateway_retry(request_fn, method="POST", url="/inspect")

    assert response is ok
    assert len(calls) == 2


def test_a_successful_call_is_made_once():
    ok = _Response(200, content_type="application/json", text="{}")
    request_fn, calls = _answering(ok)

    response = _request_with_gateway_retry(request_fn, method="POST", url="/inspect")

    assert response is ok
    assert len(calls) == 1
