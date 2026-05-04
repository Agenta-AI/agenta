import pytest

import agenta as ag


def setup_agenta(cls_account):
    api_url = cls_account["api_url"]
    credentials = cls_account["credentials"]

    ag.init(
        host=api_url[:-4],
        api_key=credentials[7:],
    )


@pytest.fixture(scope="class", autouse=True)
def ag_sdk(cls_account):
    setup_agenta(cls_account)
    yield
