# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory to /app
WORKDIR /app

# Install Poetry
RUN pip install --upgrade pip \
    && pip install poetry

# Copy the current directory contents into the container at /app 
COPY poetry.lock /app
COPY pyproject.toml /app
COPY README.md /app

# Install the dependencies using Poetry
RUN poetry config virtualenvs.create false \
    && poetry install --no-dev

# Define environment variable
# ENV NAME World

# Run app.py when the container launches
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
# CMD ["python", "api/sleep.py"]