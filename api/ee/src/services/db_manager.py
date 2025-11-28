import uuid

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.models.db_models import DeploymentDB


async def create_deployment(
    app_id: str,
    project_id: str,
    uri: str,
) -> DeploymentDB:
    """Create a new deployment.
    Args:
        app_id (str): The app variant to create the deployment for.
        project_id (str): The project variant to create the deployment for.
        uri (str): The URI of the service.
    Returns:
        DeploymentDB: The created deployment.
    """

    async with engine.core_session() as session:
        try:
            deployment = DeploymentDB(
                app_id=uuid.UUID(app_id),
                project_id=uuid.UUID(project_id),
                uri=uri,
            )

            session.add(deployment)
            await session.commit()
            await session.refresh(deployment)

            return deployment
        except Exception as e:
            raise Exception(f"Error while creating deployment: {e}")
