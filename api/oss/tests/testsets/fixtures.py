async def create_testset(client, testset_name: str, headers: dict):
    """
    Factory fixture to create a new testset.
    """

    response = await client.post(
        f"testsets", json={"name": testset_name, "csvdata": []}, headers=headers
    )
    response.raise_for_status()
    response_data = response.json()

    return response_data


async def delete_testset(client, testset_id: str, headers: dict):
    """
    Factory fixture to delete a testset.
    """

    response = await client.request(
        "DELETE",
        f"testsets",
        json={"testset_ids": [testset_id]},
        headers=headers,
    )
    response.raise_for_status()

    return response
