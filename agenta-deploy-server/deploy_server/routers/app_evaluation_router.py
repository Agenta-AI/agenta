from fastapi import HTTPException, APIRouter
from deploy_server.models.api.app_evaluation_model import ComparisonTable, EvaluationRow, EvaluationRowUpdate, ComparisonTableUpdate
from deploy_server.services.db_mongo import comparison_tables, evaluation_rows
from datetime import datetime
from bson import ObjectId
from typing import List


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

@router.put("/{comparison_table_id}")
async def update_comparison_table(comparison_table_id: str, comparison_table: ComparisonTableUpdate):
  comparison_table_dict = comparison_table.dict()
  comparison_table_dict["updated_at"] = datetime.utcnow()
  result = await comparison_tables.update_one(
        {'_id': ObjectId(comparison_table_id)},
        {'$set': {'variants': comparison_table_dict["variants"]}}
    )
  if result.acknowledged:
    return comparison_table_dict
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

@router.get("/", response_model=List[ComparisonTable])
async def get_comparison_table_id():
  cursor = comparison_tables.find().sort('created_at', -1)
  items = await cursor.to_list(length=100)  # limit length to 100 for the example
  for item in items:
      item['id'] = str(item['_id'])
  return items

@router.get("/{comparison_table_id}/results")
async def fetchResults(comparison_table_id: str):
  print("fetchResults")
  print(comparison_table_id)
  document = await comparison_tables.find_one({"_id": ObjectId(comparison_table_id)})

  results = {}
  print(document["variants"])
  
  countFlag = await evaluation_rows.count_documents({
    'vote': 'Flag',
    'comparison_table_id' : comparison_table_id
  })
  results["flag"] = countFlag;

  countAllComparisonTableEvaluationRows = await evaluation_rows.count_documents({
    'comparison_table_id' : comparison_table_id
  })
  results["nbOfRows"] = countAllComparisonTableEvaluationRows

  for item in document["variants"]:
    countVariant = await evaluation_rows.count_documents({
      'vote': item,
      'comparison_table_id' : comparison_table_id
    })
    results[item] = countVariant
  return {"results": results}
