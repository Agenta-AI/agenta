import os
import docker
os.environ["DOCKER_REGISTRY_URL"] = "127.0.0.1:5000"
os.environ["DATABASE_URL"] = "localhost:5432"
os.environ["REGISTRY"] = "agenta-server"


client = docker.from_env()

all_images = client.images.list()
for image in all_images:
    print(image.tags)

image = client.images.get(
    f"agenta-server/test:latest")
container = client.containers.run(image, detach=True)
