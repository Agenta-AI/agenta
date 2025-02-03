#!/bin/bash

if [ -f .env ]; then
    source .env
fi

# Run uvicorn with reload watching both app and agenta-cli directories

exec python main.py
