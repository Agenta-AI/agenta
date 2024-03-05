import aiodocker


async def retrieve_logs(container_id: str) -> str:
    """
    Retrieves and returns the last 10 lines of logs (both stdout and stderr)
    for a specified Docker container.

    Args:
        container_id (str): The docker container identifier

    Returns:
        the last 10 lines of logs
    """

    async with aiodocker.Docker() as client:
        container = await client.containers.get(container_id)
        logs = await container.log(stdout=True, stderr=True)
        outputs = logs[::-1][:10]
        return "".join(outputs)
