Contains the backend for the container registry.

This backend takes care of the following:

- Instanciating a container registry
- Managing the container versions in the registry
- Instanciating the containers for evaluation
- Removing the container
- Shutting down the containers

What it does not take care of:
- Running the evaluation against the containers



## Architecture
This backend instanciate a docker registry and an api endpoint.
The CLI builds the apps into docker container images and pushes them to the registry, then posts the container information to the api endpoint.
This backend updates its local database with the new container information.

The UI-backend lists the container information through the api endpoint.
The 
## API interface

### Add container
api: POST /containers/add
description: Add a container to the registry