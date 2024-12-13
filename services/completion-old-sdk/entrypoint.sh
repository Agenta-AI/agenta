#!/bin/bash

if [ -f .env ]; then
    source .env
fi

exec python main.py
