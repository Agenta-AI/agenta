# Database Migrations

This guide outlines the process for performing database migrations using Beanie with the Agenta backend system. 

Beanie is a MongoDB ODM (Object Document Mapper) for Python. More information about Beanie can be found [here](https://github.com/roman-right/beanie).

## Steps for Migration

### Accessing the Backend Docker Container

To access the backend Docker container:

1. **List Docker Containers**: List all running Docker containers with the command:

    ```bash
    docker ps
    ```

2. **Identify the `agenta-backend` Container ID**: Note down the container ID from the output. Example output:

    ```bash
    CONTAINER ID   IMAGE                    COMMAND                  CREATED         STATUS         PORTS                                      NAMES
    ae0c56933636   agenta-backend           "uvicorn agenta_back…"   3 hours ago     Up 3 hours     8000/tcp                                   agenta-backend-1
    e35f6c8b7fcb   agenta-agenta-web        "docker-entrypoint.s…"   3 hours ago     Up 3 hours     0.0.0.0:3000->3000/tcp                     agenta-agenta-web-1
    ```

3. **SSH into the Container**: Use the following command, replacing `CONTAINER_ID` with your container's ID:

    ```bash
    docker exec -it CONTAINER_ID bash
    ```

4. **Install Required Beanie Version (This is only temporary)**: Run the following command:

    ```bash
    sh install_forked_beanie.sh
    ```

### Performing the Migration

To perform the database migration:

1. **Navigate to Migration Directory**: Change the directory to the migration folder:

    ```sh
    cd agenta_backend/migrations/{migration_name}
    ```

    Replace `{migration_name}` with the actual migration name, e.g., `17_01_24_pydantic_and_evaluations`.

2. **Run Beanie Migration**: Execute the migration command:

    ```sh
    beanie migrate --no-use-transaction -uri 'mongodb://username:password@mongo' -db 'agenta_v2' -p .
    ```

    Ensure to replace `username`, `password`, and other placeholders with actual values.

Follow these steps for a successful database migration in your Agenta backend system.
