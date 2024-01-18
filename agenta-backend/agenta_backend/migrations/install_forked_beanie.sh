#!/bin/sh

# Install git and clone the necessary repository
apt-get update -y \
    && apt-get install -y git \
    && git clone https://github.com/mmabrouk/beanie /app/beanie \
    && cd /app/beanie && pip install .
