# Agenta CLI tool.

The Agenta CLI tool enables users to add new versions of their code to the Agenta platform, allowing them to be evaluated, compared to other versions, and deployed.
Installation

To install dependencies, run the following command:

```poetry install```

## Usage

To enter the virtual environment, run the following command:

```poetry shell```

To build the Docker image for the version and upload the container to the registry, run the following command:

```agenta up folder```

To start from a template, run the following command:

```agenta init```

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

## How does it work
When you run `agenta up folder`, the CLI tool will do the following:
- Build a Docker image for your code
- Upload the Docker image to the Agenta registry