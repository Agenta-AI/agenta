import uuid
from pathlib import Path
from fastapi import UploadFile, APIRouter
from agenta_backend.models.api.api_models import Image
from agenta_backend.services.container_manager import build_image_job


router = APIRouter()


@router.post("/build_image/")
async def build_image(app_name: str, variant_name: str, tar_file: UploadFile) -> Image:
    """Takes a tar file and builds a docker image from it

    Arguments:
        app_name -- _description_
        variant_name -- _description_
        tar_file -- _description_

    Returns:
        _description_
    """
    # Create a unique temporary directory for each upload
    temp_dir = Path(f"/tmp/{uuid.uuid4()}")
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded file to the temporary directory
    tar_path = temp_dir / tar_file.filename
    with tar_path.open("wb") as buffer:
        buffer.write(await tar_file.read())

    image_name = f"agenta-server/{app_name.lower()}_{variant_name.lower()}:latest"

    return build_image_job(app_name, variant_name, tar_path, image_name, temp_dir)
