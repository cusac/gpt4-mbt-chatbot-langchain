import type { NextApiRequest, NextApiResponse } from 'next';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { evalQuestionChain, makeChain } from '@/utils/makechain';
import { pinecone } from '@/utils/pinecone-client';
import { PINECONE_INDEX_NAME, PINECONE_NAME_SPACE } from '@/config/pinecone';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { userMessage, apiMessage, source_docs } = req.body;

  if (!source_docs) {
    return res.status(400).json({ message: 'No source_doc in the request' });
  }
  // OpenAI recommends replacing newlines with spaces for best results
  const sanitizedUserMessage = userMessage.trim().replaceAll('\n', ' ')
  const sanitizedApiMessage = apiMessage.trim().replaceAll('\n', ' ')
  

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const sendData = (data: string) => {
    res.write(`data: ${data}\n\n`);
  };

  sendData(JSON.stringify({ data: '' }));

  //create chain
  const chain = evalQuestionChain()

  // console.log("EVALUATIONS SOURCES BASED ON QUESTION:", userMessage, apiMessage, source_docs)

  try {

    // const response = await chain.call({
    //   question: sanitizedQuestion,
    //   source_docs: source_docs.map((doc: any, index: number) => doc.pageContent )
    // });

    const promises = source_docs.map((doc: any, index: number) => chain.call({
      user_message: sanitizedUserMessage,
      api_message: sanitizedApiMessage,
      source_doc: doc.pageContent
    }))
    const response = await Promise.all(promises)
    
    

    console.log("EVAL RESPONSE:", response)
    // console.log('response', response);
    sendData(JSON.stringify({ source_scores: response.map(r => r.text) }));
    res.end();
  } catch (error) {
    console.log('error', error);
  } 
}
