# Agenta CLI tool.

The Agenta CLI tool enables users to add new versions of their code to the Agenta platform, allowing them to be evaluated, compared to other versions, and deployed.
Installation

To install dependencies, run the following command:

```poetry install```

## Requirements
You need to have docker installed to be able to use the cli locally. 

## How does it work

The CLI allows you to push in one command your projects for evaluation in the dashboard.

You only need to modify your code very slightly by adding a decorator to your chat/ and ingest functions.

Under the hood the cli packages your code into a docker container and send it to a registry.

Later the dashboard spins off these containers and runs the benchmarks and evaluations over them.
## Quickstart

To enter the virtual environment, run the following command:

```poetry shell```

To init a new project and start from a simple template. Run the following command in an empty folder:

```agenta init```

Build your code and add it to the platform to be tested in the UI. This command builds a Docker image for the version and upload the container to the registry:

```agenta add-variant```

Start your code as a containarized service locally:

```agenta start```


## How to write code to be user in agenta

To write code that can be used in Agenta, you need to structure your project as follows:

### Project Structure
The project folder should contain:
1. A Python file named `app.py`
2. A `requirements.txt` file with all the necessary dependencies for running your code

### app.py

The `app.py` file should have the following functions:
0. import `agenta`
1. A function named chat that is exposed using the `@agenta.post` decorator
2. An optional function named ingest that is exposed using the `@agenta.post` decorator

### Example Project Structure

Here's an example of how your project folder might look:

my_agenda_project/
│
├── app.py
└── requirements.txt

### Example app.py
```python
from agenta import post, get

class ChatInput(BaseModel):
    messages: List[str]

class ChatOutput(BaseModel):
    response: str

@post
def chat(input_data: ChatInput) -> ChatOutput:
    # Your chat function implementation here
    response = "Hello, World!"
    return ChatOutput(response=response)

class IngestInput(BaseModel):
    data: List[str]

class IngestOutput(BaseModel):
    status: str

@post
def ingest(input_data: IngestInput) -> IngestOutput:
    # Your ingest function implementation here (if needed)
    status = "Data ingestion successful."
    return IngestOutput(status=status)

```
## How to deal with secrets:
- For now we are using a .env file to store secrets.
- Create an .env file to store your secrets.
- The .env file is built into the image and uploaded to the local registry. THIS IS NOT GOOD. WE WILL FIX IT ASAP.