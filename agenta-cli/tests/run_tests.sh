#!/bin/bash

set -e

OPENAI_API_KEY=sk-xxxxxxxx AGENTA_HOST=http://localhost AGENTA_API_KEY=xxxxx.xxxxxxxxxxxxx pytest management/ -v -m variant_management # run variant_management tests

