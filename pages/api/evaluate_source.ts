import type { NextApiRequest, NextApiResponse } from 'next';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { evalQuestionChain, makeChain, formatDocs } from '@/utils/makechain';
import { pinecone } from '@/utils/pinecone-client';
import { PINECONE_INDEX_NAME, PINECONE_NAME_SPACE } from '@/config/pinecone';
import * as fs from 'fs';

if (!process.env.MBT_API_URL) {
  throw new Error('Missing MBT API host in .env file');
}

// Source Scores type
export type SourceScore = {
  source_doc_id: number;
  explanation: string;
  score: number;
  sourceDoc: SourceDoc;
};

export type MBTLink = {
  link: string;
  title: string;
  description: string;
};

export type SourceDoc = {
  pageContent: string;
  metadata: {
    'loc.lines.from': number;
    'loc.lines.to': number;
    source: string;
    startTs?: number;
    endTs?: number;
    ytLink?: string;
    mbtLinks: MBTLink[];
  };
};

export type MBTSegmentInfo = {
  videoId: string;
  segmentId: string;
  title: string;
  description: string;
  start: number;
  end: number;
};

function timestampToSeconds(timestamp?: string): number | null {
  const regex = /(?:([0-9]{1,2}):)?([0-5][0-9]):([0-5][0-9])\.(\d{3})/;
  const match = (timestamp || '').match(regex);

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
      first: Math.round(timestampToSeconds(firstTimestamp) || 0),
      last: Math.round(timestampToSeconds(lastTimestamp) || 0),
    };
  } else {
    return { first: null, last: null };
  }
}

// Given a source_path, get the ytLink by querying the mbt api
export async function getYTLinkByDocName(source_path: string) {
  const fileName = source_path.split('/').pop() || '';

  const url = `${process.env.MBT_API_URL}/find-videoid-by-whisper?whisperDoc=${fileName}`;
  // Do a GET request to the MBT API with the filename as a query param
  const response = await fetch(url);
  const data = await response.json();

  // Check if the response is ok
  if (!response.ok) {
    console.log('ERROR', data);
    throw new Error('Error getting videoId from MBT API');
  }

  const { videoId } = data;

  // Check videoId
  if (!isValidVideoId(videoId)) {
    throw new Error('Invalid videoId');
  }

  // Create the youtube link
  const ytLink = `https://www.youtube.com/watch?v=${videoId}`;
  return ytLink;
}

// Function that takes in text and creates a hash Id number
export const createHashId = (text: string) => {
  return text.split('').reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
};

function extractVideoId(ytLink?: string) {
  const ytRegex =
    /^(?:https?:\/\/)?(?:www\.)?(?:youtu(?:\.be\/|be\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)))([\w\-]{10,12})(?:[\&\?](?:t=([0-9hms]{1,9}|[0-9]{1,9})))?.*$/;
  const match = (ytLink || '').match(ytRegex);

  if (match && match[1]) {
    return match[1];
  } else {
    console.log("Invalid YouTube link: ", ytLink)
    // throw new Error('Invalid YouTube link.');
  }
}
function isValidVideoId(videoId?: string) {
  const videoIdRegex = /^[\w-]{10,12}$/;
  return videoIdRegex.test(videoId || '');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  let { userMessage, apiMessage, source_docs } = req.body;

  if (!source_docs) {
    return res.status(400).json({ message: 'No source_doc in the request' });
  }
  // OpenAI recommends replacing newlines with spaces for best results
  const sanitizedUserMessage = userMessage.trim().replaceAll('\n', ' ');
  const sanitizedApiMessage = apiMessage.trim().replaceAll('\n', ' ');

  //create chain
  const chain = evalQuestionChain();

  try {
    source_docs = await Promise.all(
      source_docs.map(async (doc: SourceDoc, index: number) => {
        const { first, last } = extractFirstAndLastTimestamps(doc.pageContent);
        doc.metadata.startTs = first || 0;
        doc.metadata.endTs = last || undefined;
        const ytLink = await getYTLinkByDocName(doc.metadata.source);
        if (!ytLink) {
          doc.metadata.ytLink = 'No YouTube link found';
        } else {
          // ytlink with timestamp of first
          const ytLinkWithTimestamp = ytLink + `&t=${first}`;
          doc.metadata.ytLink = ytLinkWithTimestamp;
        }
        doc.pageContent = formatDocs(doc.pageContent)
        return doc;
      }),
    );

    // console.log('SOURCE DOCS', source_docs);

    const evalPromises = source_docs.map((doc: any, index: number) =>
      chain.call({
        user_message: sanitizedUserMessage,
        api_message: sanitizedApiMessage,
        source_doc: doc.pageContent,
        source_doc_id: createHashId(doc.pageContent),
      }),
    );

    const mbtSegmentPromises = source_docs.map(async (doc: any, index: number) => {
      // Get youtube video id from link
      const videoId = extractVideoId(doc.metadata.ytLink);

      if (!isValidVideoId(videoId)) {
        console.log("Invalid YouTube video ID: ", videoId)
        return null
      }

      // console.log('FETCHING SEGMENTS BASED ON DOC:', doc);

      const url = `${process.env.MBT_API_URL}/video/segments/timestamp-range?videoId=${videoId}&start=${doc.metadata.startTs}&end=${doc.metadata.endTs}`;
      // console.log('URL', url);
      const response = await fetch(url)
      // console.log("RANGE RESPONSE:", response)
      const responseJson = await response.json()
      // console.log("RESPONSE JSON:", responseJson)
      return responseJson
    });

    let mbtSegments: MBTSegmentInfo[] = [];
    let sourceScoresText: { text: string }[] = [];

    try {
      [mbtSegments, sourceScoresText] = await Promise.all([
        Promise.all(mbtSegmentPromises),
        Promise.all(evalPromises),
      ]);
    } catch (err) {
      console.error('Error processing source docs: ', err);
      throw err;
    }

    // console.log("mbtSegments:", mbtSegments)
    // console.log("sourceScoresText:", sourceScoresText)

    // Flatten mbtSegments
    mbtSegments = mbtSegments.flat();

    let source_scores = sourceScoresText.map((r) => {
      // console.log("R:", r.text)
      let data: any
      try {
        data = JSON.parse(r.text)
      } catch(err) {
        console.log("There was an error parsing the source score text:\n\n", r.text)
        return null
      }
      // console.log("DATA:", data)
      return data
    }).filter((r) => r !== null);

    // console.log('SOURCE SCORES:', JSON.stringify(source_scores, null, 2));

    // Update source_scores with source_doc id
    source_scores = source_scores.map((score: SourceScore, index: number) => {
      score.sourceDoc = source_docs.filter(
        (sd: SourceDoc) =>
          createHashId(sd.pageContent) === Number(score.source_doc_id),
      )[0];
      const docMbtSegments = mbtSegments.filter(
        (mbtSegment) =>
          mbtSegment.videoId ===
          extractVideoId(score.sourceDoc.metadata.ytLink!),
      );

      score.sourceDoc.metadata.mbtLinks = docMbtSegments.map((mbtSegment) => {
        return {
          title: mbtSegment.title,
          description: mbtSegment.description,
          link: `https://videosearch.my-big-toe.com/${mbtSegment.segmentId}`,
        };
      });
      return score;
    });

    // console.log('NEW SOURCE SCORES:', JSON.stringify(source_scores, null, 4));

    // sendData(JSON.stringify({ source_scores }));
    res.status(200).json({ source_scores });
    console.log('END EVALUATION REQUEST');
    res.end();
  } catch (error) {
    console.log('error', error);
    // Send error response
    //@ts-ignore
    res.status(500).json({ message: error?.message });
  }
}
