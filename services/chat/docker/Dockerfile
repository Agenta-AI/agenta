FROM python:3.10-slim

WORKDIR /app

# LAYER 1: Install general dependencies
RUN pip install --no-cache-dir --upgrade pip

# LAYER 2: Install specific requirements
COPY ./services/chat/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# LAYER 3: Install agenta CLI
COPY ./agenta-cli /app/cli
RUN pip install -e cli

# LAYER 4: Copy agenta source code
COPY ./services/chat/src /app

EXPOSE 80

CMD ["python", "main.py"]