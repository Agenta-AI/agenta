import pytest
import pytest_asyncio
from typing import Dict, Any

pytestmark = pytest.mark.asyncio


@pytest.mark.asyncio
async def test_generate(async_client, chat_url):
    payload = {
        "inputs": [
            {
                "role": "user",
                "content": "What are some innovative tech solutions for a startup?",
            }
        ]
    }
    response = await async_client.post(f"{chat_url}/generate", json=payload)
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


@pytest.mark.asyncio
async def test_run(async_client, chat_url):
    payload = {
        "inputs": [
            {
                "role": "user",
                "content": "What are the best practices for startup growth?",
            }
        ]
    }
    response = await async_client.post(f"{chat_url}/run", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "version" in data
    assert "data" in data
    assert isinstance(data["data"], str)


@pytest.mark.asyncio
async def test_generate_deployed(async_client, chat_url):
    payload = {
        "inputs": [{"role": "user", "content": "How to build a successful tech team?"}]
    }
    response = await async_client.post(f"{chat_url}/generate_deployed", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "version" in data
    assert "data" in data
    assert isinstance(data["data"], str)
