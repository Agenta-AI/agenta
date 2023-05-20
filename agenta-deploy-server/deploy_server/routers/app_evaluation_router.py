from fastapi import HTTPException, APIRouter
from deploy_server.models.api.app_evaluation_model import AppEvaluationEntry, AppEvaluationsExperiment, AppEvaluationEntryUpdate
from deploy_server.services.db_mongo import app_evaluation_entries, app_evaluation_experiments
from datetime import datetime
from bson import ObjectId

router = APIRouter()

@router.post("/", response_model=AppEvaluationsExperiment)
async def create_app_evaluation_experiment():
  app_evaluation_experiment = dict()
  app_evaluation_experiment["created_at"] = app_evaluation_experiment["updated_at"] = datetime.utcnow()
  result = await app_evaluation_experiments.insert_one(app_evaluation_experiment)
  if result.acknowledged:
    app_evaluation_experiment["id"] = str(result.inserted_id)
    return app_evaluation_experiment
  else:
    raise HTTPException(status_code=500, detail="Failed to create app_evaluation_entry")

@router.post("/{app_evaluation_experiment_id}/app_evaluation_entry", response_model=AppEvaluationEntry)
async def create_app_evaluation_entry(app_evaluation_entry: AppEvaluationEntry):
  app_evaluation_entry_dict = app_evaluation_entry.dict()
  app_evaluation_entry_dict.pop("id", None)

  app_evaluation_entry_dict["created_at"] = app_evaluation_entry_dict["updated_at"] = datetime.utcnow()
  result = await app_evaluation_entries.insert_one(app_evaluation_entry_dict)
  if result.acknowledged:
    app_evaluation_entry_dict["id"] = str(result.inserted_id)
    return app_evaluation_entry_dict
  else:
    raise HTTPException(status_code=500, detail="Failed to create app_evaluation_entry")

@router.put("/{app_evaluation_experiment_id}/app_evaluation_entry/{app_evaluation_entry_id}")
async def update_app_evaluation_entry(app_evaluation_entry_id: str, app_evaluation_entry: AppEvaluationEntryUpdate):
  app_evaluation_entry_dict = app_evaluation_entry.dict()
  app_evaluation_entry_dict["updated_at"] = datetime.utcnow()
  result = await app_evaluation_entries.update_one(
        {'_id': ObjectId(app_evaluation_entry_id)},
        {'$set': {'score': app_evaluation_entry_dict["score"]}}
    )
  if result.acknowledged:
    return app_evaluation_entry_dict
  else:
    raise HTTPException(status_code=500, detail="Failed to create app_evaluation_entry")
