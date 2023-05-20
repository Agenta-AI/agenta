from fastapi import HTTPException, APIRouter
from deploy_server.models.api.app_evaluation_model import ComparisonTable, EvaluationRow, EvaluationRowUpdate
from deploy_server.services.db_mongo import comparison_tables, evaluation_rows
from datetime import datetime
from bson import ObjectId

router = APIRouter()

@router.post("/", response_model=ComparisonTable)
async def create_comparison_table():
  comparison_table = dict()
  comparison_table["created_at"] = comparison_table["updated_at"] = datetime.utcnow()
  result = await comparison_tables.insert_one(comparison_table)
  if result.acknowledged:
    comparison_table["id"] = str(result.inserted_id)
    return comparison_table
  else:
    raise HTTPException(status_code=500, detail="Failed to create evaluation_row")

@router.post("/{comparison_table_id}/evaluation_row", response_model=EvaluationRow)
async def create_evaluation_row(evaluation_row: EvaluationRow):
  evaluation_row_dict = evaluation_row.dict()
  evaluation_row_dict.pop("id", None)

  evaluation_row_dict["created_at"] = evaluation_row_dict["updated_at"] = datetime.utcnow()
  result = await evaluation_rows.insert_one(evaluation_row_dict)
  if result.acknowledged:
    evaluation_row_dict["id"] = str(result.inserted_id)
    return evaluation_row_dict
  else:
    raise HTTPException(status_code=500, detail="Failed to create evaluation_row")

@router.put("/{comparison_table_id}/evaluation_row/{evaluation_row_id}")
async def update_evaluation_row(evaluation_row_id: str, evaluation_row: EvaluationRowUpdate):
  evaluation_row_dict = evaluation_row.dict()
  evaluation_row_dict["updated_at"] = datetime.utcnow()
  result = await evaluation_rows.update_one(
        {'_id': ObjectId(evaluation_row_id)},
        {'$set': {'vote': evaluation_row_dict["vote"]}}
    )
  if result.acknowledged:
    return evaluation_row_dict
  else:
    raise HTTPException(status_code=500, detail="Failed to create evaluation_row")
