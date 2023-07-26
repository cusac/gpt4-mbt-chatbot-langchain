import type { NextApiRequest, NextApiResponse } from 'next';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { updateSummary, makeChain, formatDocs } from '@/utils/makechain';
import { pinecone } from '@/utils/pinecone-client';
import { PINECONE_INDEX_NAME, PINECONE_NAME_SPACE } from '@/config/pinecone';
import { limitTokens } from '../../scripts/0_utils'
import * as fs from 'fs';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  let { currentSummary, history } = req.body;

  if (!currentSummary) {
    return res.status(400).json({ message: 'No currentSummary in the request' });
  }
  if (!history) {
    return res.status(400).json({ message: 'No history in the request' });
  }

  try {
    const formattedHistory = JSON.stringify(history.map((item: any) => {
      item[0] = `Human: ${item[0]}`
      item[1] = `AI: ${item[1]}`

      return item.join('\n\n')
    }), null, 2)
    const newSummary = await updateSummary(currentSummary, formattedHistory)

    console.log("NEW SUMMARY", newSummary)


    const limitedSummaryObject = await limitTokens(
      { summary: newSummary },
      500,
      200,
      1,
    );

    const limitedSummary = limitedSummaryObject.summary;

    // sendData(JSON.stringify({ source_scores }));
    res.status(200).json({ newSummary: limitedSummary });
    res.end();
  } catch (error) {
    console.log('error', error);
    // Send error response
    //@ts-ignore
    res.status(500).json({ message: error?.message });
  }
}
