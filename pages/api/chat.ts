import type { NextApiRequest, NextApiResponse } from 'next';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { makeChain } from '@/utils/makechain';
import { pinecone } from '@/utils/pinecone-client';
import { PINECONE_INDEX_NAME, PINECONE_NAME_SPACE } from '@/config/pinecone';
import PubNub from 'pubnub';


let pubnub = new PubNub({
  publishKey: 'pub-c-54f26b1f-cd33-4520-b796-b7243505d84e',
  subscribeKey: 'sub-c-61af9b42-e1d7-11e7-9e25-9e24923e4f82',
  userId: 'myUniqueUserId',
});

let THROTTLE: number = 1;

if (process.env.NEXT_PUBLIC_ENV === 'production') {
  THROTTLE = 10;
}

let queue: any[] = [];
let counter = 0;

const publishMessage = async (message: any) => {
  // With the right payload, you can publish a message, add a reaction to a message,
  // send a push notification, or send a small payload called a signal.
  const publishPayload = {
      channel : "chat-channel",
      message
  };
  await pubnub.publish(publishPayload);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { question, history, summary, version } = req.body;

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
    if (process.env.NEXT_PUBLIC_ENV === 'development') {
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

      publishMessage(data);
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
  const chain = makeChain(vectorStore, version, (token: string) => {
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

    if (process.env.NEXT_PUBLIC_ENV === 'production') {
      await waitForDoneMessages();
    }

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
