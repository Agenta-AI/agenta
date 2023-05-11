from fastapi import APIRouter, HTTPException
from deploy_server.services import docker_runtime
from deploy_server.models.container import Container
from typing import List

router = APIRouter()


@router.get("/")
async def list_containers():
    # try:
    containers = docker_runtime.list_containers()
    print(containers)
    return {"containers": containers}
    # except Exception as e:
    #     raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{container_id}")
async def stop_and_delete_container(container_id: str):
    try:
        docker_runtime.stop_container(container_id)
        docker_runtime.delete_container(container_id)
        return {"detail": "Container stopped and deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
