import mongoose from 'mongoose';
import { NextApiRequest, NextApiResponse } from 'next';
import connectMongo  from '../../utils/connectMongo'

// TODO: Fix issue to get all fields
// const LLMCallSchema = new mongoose.Schema({
//   prompt: {
//     type: [[[String]]],
//     required: true
//   },
//   output: String,
//   params: Object
// });
const LLMCallSchema = new mongoose.Schema({});
const LLMCallModel = mongoose.models.LLMCall || mongoose.model('LLMCall', LLMCallSchema, 'l_l_m_call');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {

  try {
    console.log('CONNECTING TO MONGO');
    await connectMongo();
    console.log('CONNECTED TO MONGO');

    const data = await LLMCallModel.find({});
    console.log(data)
    return res.status(200).json(data);
  } catch (error) {
    console.log(error);
    res.json({ message: 'error' });
  }
}