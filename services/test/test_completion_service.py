import pytest
import pytest_asyncio
from typing import Dict, Any

pytestmark = pytest.mark.asyncio


async def test_health(async_client, completion_url):
    response = await async_client.get(f"{completion_url}/health")
    assert response.status_code == 200
    data = response.json()
    assert data == {"status": "ok"}


async def test_generate(async_client, completion_url):
    payload = {"inputs": {"country": "France"}}
    response = await async_client.post(f"{completion_url}/generate", json=payload)
    assert response.status_code == 200
    data = response.json()

    # Check response structure
    assert "version" in data
    assert "data" in data
    assert "tree" in data

    # Check tree structure
    tree = data["tree"]
    assert "nodes" in tree
    assert len(tree["nodes"]) > 0

    # Check first node
    node = tree["nodes"][0]
    assert "lifecycle" in node
    assert "data" in node
    assert "metrics" in node
    assert "meta" in node

    # Check configuration
    config = node["meta"]["configuration"]
    assert config["model"] == "gpt-3.5-turbo"
    assert "temperature" in config
    assert "prompt_system" in config
    assert "prompt_user" in config


async def test_playground_run(async_client, completion_url):
    payload = {"inputs": {"country": "Spain"}}
    response = await async_client.post(f"{completion_url}/playground/run", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "version" in data
    assert "data" in data
    assert isinstance(data["data"], str)


async def test_generate_deployed(async_client, completion_url):
    payload = {"inputs": {"country": "Germany"}}
    response = await async_client.post(
        f"{completion_url}/generate_deployed", json=payload
    )
    assert response.status_code == 200
    data = response.json()

    assert "version" in data
    assert "data" in data
    assert isinstance(data["data"], str)


async def test_run(async_client, completion_url):
    payload = {"inputs": {"country": "Italy"}}
    response = await async_client.post(f"{completion_url}/run", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "version" in data
    assert "data" in data
    assert isinstance(data["data"], str)
