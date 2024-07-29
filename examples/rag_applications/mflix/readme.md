# Step-by-step Guide

## Vector Database (MongoDB)

1. Connect to [MongoDB ATLAS](https://www.mongodb.com/products/platform/atlas-database)
2. Create a Cluster
3. Configure Database Access to access data from username and password
4. Configure Network Access to allow for ingress from your IP address
5. Load [sample datasets](https://www.mongodb.com/docs/atlas/sample-data/#std-label-load-sample-data), expecially the [mflix dataset](https://www.mongodb.com/docs/atlas/sample-data/sample-mflix/)

## LLM Provider (OpenAI)

1. Connect to [OpenAI Platform](https://platform.openai.com/)
2. Create API keys

## RAG Application

1. Set environment variables
   * `AGENTA_API_KEY`
   * `OPENAI_API_KEY`
   * `MONGODB_ATLAS_URI`
   * `MONGODB_DATABASE_NAME`
2. Install dependencies (optional)
   * `pip install -r requirements`
3. Create app variant
   * `agenta init`
4. Serve app variant
   * `agenta variant serve app.py`
