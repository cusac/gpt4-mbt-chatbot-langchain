import type { NextApiRequest, NextApiResponse } from 'next';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { evalQuestionChain, makeChain } from '@/utils/makechain';
import { pinecone } from '@/utils/pinecone-client';
import { PINECONE_INDEX_NAME, PINECONE_NAME_SPACE } from '@/config/pinecone';
import * as fs from 'fs';

// Source Scores type
export type SourceScore = {
  source_doc_id: number;
  explanation: string;
  score: number;
  sourceDoc: SourceDoc;
};

export type SourceDoc = {
  pageContent: string;
  metadata: {
    'loc.lines.from': number;
    'loc.lines.to': number;
    source: string;
    link: string;
  };
};

function timestampToSeconds(timestamp: string): number | null {
  const regex = /(?:([0-9]{1,2}):)?([0-5][0-9]):([0-5][0-9])\.(\d{3})/;
  const match = timestamp.match(regex);

  if (match) {
    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const milliseconds = parseInt(match[4], 10);

    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  }

  return null;
}

function extractFirstAndLastTimestamps(text: string): {
  first: number | null;
  last: number | null;
} {
  const regex = /(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})/g;
  const matches = Array.from(text.matchAll(regex));

  if (matches.length > 0) {
    const firstTimestamp = matches[0][0];
    const lastTimestamp = matches[matches.length - 1][0];
    return {
      first: timestampToSeconds(firstTimestamp),
      last: timestampToSeconds(lastTimestamp),
    };
  } else {
    return { first: null, last: null };
  }
}

// Given a source_path, extract the file name, then read the contents of a file name that matches the source file name + "_yt_link.txt"
export function extractYTLink(source_path: string) {
  const fileName = source_path.split('/').pop() || '';
  const ytLinkFileName = fileName?.split('.').shift() + '_yt_link.txt';
  const ytLinkPath = source_path.replace(fileName, ytLinkFileName);
  const ytLink = fs.readFileSync(ytLinkPath);
  return ytLink;
}

// Function that takes in text and creates a hash Id number
export const createHashId = (text: string) => {
  return text.split('').reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  console.log('NEW EVALUATION REQUEST', req.body);
  let { userMessage, apiMessage, source_docs } = req.body;

  if (!source_docs) {
    return res.status(400).json({ message: 'No source_doc in the request' });
  }
  // OpenAI recommends replacing newlines with spaces for best results
  const sanitizedUserMessage = userMessage.trim().replaceAll('\n', ' ');
  const sanitizedApiMessage = apiMessage.trim().replaceAll('\n', ' ');

  // res.writeHead(200, {
  //   'Content-Type': 'text/event-stream',
  //   'Cache-Control': 'no-cache, no-transform',
  //   Connection: 'keep-alive',
  // });

  // const sendData = (data: string) => {
  //   res.write(`data: ${data}\n\n`);
  // };

  // sendData(JSON.stringify({ data: '' }));

  //create chain
  const chain = evalQuestionChain();

  // console.log("EVALUATIONS SOURCES BASED ON QUESTION:", userMessage, apiMessage, source_docs)

  try {
    const promises = source_docs.map((doc: any, index: number) =>
      chain.call({
        user_message: sanitizedUserMessage,
        api_message: sanitizedApiMessage,
        source_doc: doc.pageContent,
        source_doc_id: createHashId(doc.pageContent),
      }),
    );
    const response = await Promise.all(promises);

    let source_scores = response.map((r) => JSON.parse(r.text));

    console.log('ORIGINAL SOURCE SCORES:', source_scores);

    source_docs = source_docs.map((doc: SourceDoc, index: number) => {
      const { first, last } = extractFirstAndLastTimestamps(doc.pageContent);
      const ytLink = extractYTLink(doc.metadata.source);
      if (!ytLink) {
        doc.metadata.link = 'No YouTube link found';
      } else {
        // ytlink with timestamp of first
        const ytLinkWithTimestamp = ytLink + `&t=${first}`;
        doc.metadata.link = `${ytLinkWithTimestamp}`;
      }
      return doc;
    });

    // console.log("NEW SOURCE DOCS:", source_docs)

    // Update source_scores with source_doc id
    source_scores = source_scores.map((score: SourceScore, index: number) => {
      score.sourceDoc = source_docs.filter(
        (sd: SourceDoc) =>
          createHashId(sd.pageContent) === Number(score.source_doc_id),
      )[0];
      return score;
    });

    console.log('NEW SOURCE SCORES:', JSON.stringify(source_scores, null, 4));

    // sendData(JSON.stringify({ source_scores }));
    res.status(200).json({ source_scores });
    console.log('END EVALUATION REQUEST');
    res.end();
  } catch (error) {
    console.log('error', error);
  }
}
