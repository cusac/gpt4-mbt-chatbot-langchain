import type { NextApiRequest, NextApiResponse } from 'next';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { makeChain } from '@/utils/makechain';
import { pinecone } from '@/utils/pinecone-client';
import { PINECONE_INDEX_NAME, PINECONE_NAME_SPACE } from '@/config/pinecone';
import Pusher from 'pusher';

// Instantiate pusher
var pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: '374822fd0361d57a5da2',
  secret: process.env.PUSHER_SECRET || '',
  cluster: 'us3',
  useTLS: true,
});

let THROTTLE: number = 1;

if (process.env.NEXT_PUBLIC_ENV === 'production') {
  THROTTLE = 10;
}

let queue: any[] = [];
let counter = 0;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { question, history, summary } = req.body;

  let doneSendingMessages = false;

  if (!question) {
    return res.status(400).json({ message: 'No question in the request' });
  }
  // OpenAI recommends replacing newlines with spaces for best results
  const sanitizedQuestion = question.trim().replaceAll('\n', ' ');

  const index = pinecone.Index(PINECONE_INDEX_NAME);

  /* create vectorstore*/
  // TODO: add organization
  const vectorStore = await PineconeStore.fromExistingIndex(
    new OpenAIEmbeddings({ maxConcurrency: 5 }),
    {
      pineconeIndex: index,
      textKey: 'text',
      namespace: PINECONE_NAME_SPACE,
    },
  );

  res.writeHead(200, {
    'Content-Type': 'text/event-stream;charset=utf-8',
    'Content-Encoding': 'none',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });

  let count = 1;

  const sendData = (data: string) => {
    console.log('SENDING DATA:', data);
    if (process.env.NEXT_PUBLIC_ENV === 'development') {
      console.log('SENDING DATA DEV');
      res.write(`data: ${data}\n\n`);
    } else {
      let dataJSON;
      try {
        dataJSON = JSON.parse(data);
        dataJSON.id = count;
        data = JSON.stringify(dataJSON);
      } catch (e) {}

      if (data.includes('[DONE MESSAGES]')) {
        console.log("WE DONE NOW")
        doneSendingMessages = true;
      }

      pusher.trigger('chat-channel', 'chat-event', data);
      count++;
    }
  };

  const throttleSendData = (data: string) => {
    queue.push(data);
    counter++;
    if (counter >= THROTTLE) {
      sendData(JSON.stringify({ data: queue.join('') }));
      queue = [];
      counter = 0;
    }
  };

  const flushMessages = () => {
    if (queue.length > 0) {
      const data = JSON.stringify({ data: queue.join('') });
      sendData(data);
      queue = [];
      counter = 0;
    }
  };

  const sendDataWrite = (data: string) => {
    res.write(`data: ${data}\n\n`);
  };

  const waitForDoneMessages = async () => {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (doneSendingMessages) {
          clearInterval(interval);
          resolve(true);
        } else {
          console.log('NOT DONE WAITING YET');
        }
      }, 100);
    });
  };

  sendDataWrite(JSON.stringify({ data: '' }));

  //create chain
  const chain = makeChain(vectorStore, (token: string) => {
    throttleSendData(token);
  });

  try {
    //Ask a question
    // console.log("History: ", history)
    const response = await chain.call({
      question: sanitizedQuestion,
      chat_history: history || [],
      summary: summary || '',
    });

    flushMessages();
    sendData(JSON.stringify({ data: '[DONE MESSAGES]' }));
    flushMessages();

    await waitForDoneMessages();

    console.log("MOVING ON")

    // console.log('response with sources: ', response);
    sendDataWrite(JSON.stringify({ sourceDocs: response.sourceDocuments }));
  } catch (error) {
    console.error('error', error);
    sendDataWrite(`[ERROR] ${error?.message}`);
  } finally {
    sendDataWrite('[DONE]');
    res.end();
  }
}
