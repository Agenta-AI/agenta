async def create_application(client, app_name: str, headers: dict):
    """
    Factory fixture to create a new application.
    """

    response = await client.post("apps/", json={"app_name": app_name}, headers=headers)
    response.raise_for_status()
    response_data = response.json()

    return response_data


async def delete_application(client, app_id: str, headers: dict):
    """
    Factory fixture to delete an application.
    """

    response = await client.delete(f"apps/{app_id}", headers=headers)
    response.raise_for_status()

    return response
