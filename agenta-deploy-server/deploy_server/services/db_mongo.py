from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient("mongodb://username:password@mongo:27017")
database = client["agenta"]

app_evaluation_entries = database["app_evaluation_entries"]
app_evaluation_experiments = database["app_evaluation_experiments"]
