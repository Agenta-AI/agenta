#!/bin/bash

set -e

OPENAI_API_KEY=sk-xxxxx AGENTA_HOST=http://localhost AGENTA_API_KEY=xxxx.xxxxxxxxxxxxxxx pytest -n 2 -v ./management/*
BASE_URL=http://127.0.0.1 AGENTA_HOST=http://localhost AGENTA_API_KEY=xxxx.xxxxxxxxxxxxxxx pytest -v ./sdk_routing/*
