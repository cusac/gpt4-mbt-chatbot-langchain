import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import { PromptTemplate } from 'langchain/prompts';
import {
  splitTextIntoChunks,
  callChain,
  limitTokens,
  parsePartialJson,
  getGlobalTokenCount,
  removeSpeakerLabels,
  getLabeledSegmentsAndLabelsSplit,
  segmentArrayToText,
  replaceKeyInObject,
  replaceKeysWithClosestMatch,
  compareJson,
  checkScores,
} from './0_utils';

const generateSpeakerSummaries = async (text: string) => {
  const maxSegmentChars = 1500; // Adjust this value based on the model's token limit
  const maxChunkChars = 3500;
  const labelsAndSegments = getLabeledSegmentsAndLabelsSplit(
    text,
    maxSegmentChars,
  );

  console.log('TEXST:', text);

  console.log('LABELS:', labelsAndSegments);

  let chunks = segmentArrayToText(labelsAndSegments, maxChunkChars);

  console.log('CHUNKS:', chunks);

  let allLabeledChunks: any[] = [];

  let speaker_summaries = 'None. This is the first portion of the transcript.';

  let chunkCount = 0;

  for (const chunk of chunks) {
    console.log('CHUNK:', chunk);

    const LABEL_PROMPT =
      PromptTemplate.fromTemplate(`Please analyze the following labeled portion of a transcript, taking into account the existing speaker summaries provided. Your task is to UPDATE the speaker summaries using the transcript portion. The summaries should NOT refer to the current portion specifically or use phrases like "in this portion"; instead, they should reflect the accumulated content from the entire transcript for each speaker up to this point. The end goal is to have a complete and consistent summary of each speaker after all of the portions have been analyzed. 

      IMPORTANT: Each speaker summary should ONLY include the content spoken by that speaker. Do NOT include any content spoken by other speakers in the summary.

    Existing Speaker Summaries:
    {speaker_summaries}
    
    Transcript Portion:
    {transcript_chunk}
    
    The response should ONLY be a JSON object with the updated speaker summaries in the following format:
    {{
      "SPEAKER_A": {{
        "summary": "...",
      }},
      "SPEAKER_B": {{ // OPTIONAL
        "summary": "...",
      }},
      "SPEAKER_C": {{ // OPTIONAL
        "summary": "...",
      }}
      // MAX 3 speakers with similar fields as needed
    }}

    NOTE: If more than 3 speakers are found, please only include the first 3 in the response.
    IMPORTANT: Please do NOT include more than 3 speakers in the response (i.e. NO "SPEAKER_D" field).
    IMPORTANT: Please do NOT include any other information in the response other than the JSON object.
    `);

    try {
      const response = await callChain(LABEL_PROMPT, 1500, {
        transcript_chunk: chunk,
        speaker_summaries,
      });

      const labeledChunk = await limitTokens(parsePartialJson(response.text));

      console.log('Labeled chunk:', labeledChunk);

      if (labeledChunk) {
        allLabeledChunks = allLabeledChunks.concat(labeledChunk);
        speaker_summaries = JSON.stringify(labeledChunk, null, 4);
      }

      chunkCount++;

      // if (chunkCount > 2) {
      //   break
      // }

      // if (chunkCount > 1) {
      //   // Write the first 2 chunks to file
      //   fs.writeFile(
      //     './chunks.json',
      //     JSON.stringify(textChunks.slice(0, 2), null, 2),
      //   );
      //   // fs.writeFile('./chunks.json', JSON.stringify(textChunks, null, 2));
      //   fs.writeFile('./qa.json', JSON.stringify(allQA, null, 2));
      //   break;
      // }
    } catch (error) {
      console.error('Error generating labeled transcripts:', error);
      //@ts-ignore
      console.error('Error details: ', error?.response?.data?.error);
      return null;
    }

    // return allLabeledChunks;
  }

  return speaker_summaries;
};

async function processDocxFile(inputTextPath: string) {
  try {
    let text = await fs.readFile(inputTextPath, 'utf8');

    // text = removeSpeakerLabels(text)

    //print first 10 lines of text
    // console.log("TEXT:", text.split('\n').slice(0, 10).join('\n'));

    let agentDescription;

    try {
      const agentDescriptionFilename = 'agent_description_short.json';
      const agentDescriptionDirectoryPath = path.join(process.cwd(), 'scripts');
      const agentDescriptionFilePath = path.join(
        agentDescriptionDirectoryPath,
        agentDescriptionFilename,
      );

      agentDescription = await fs.readFile(agentDescriptionFilePath, 'utf8');
    } catch (err) {
      console.error('Error reading agent description file:', err);
    }

    let speaker_summaries = await generateSpeakerSummaries(text);

    // speaker_summaries = await limitTokens(speaker_summaries, 500);

    // speaker_summaries = replaceKeyInObject(
    //   '_.summary',
    //   '_.speaker_content',
    //   speaker_summaries,
    // );

    // Extract filename from inputDocxPath, and use it as the output filename plus _qa.json. Save in "qa" directory
    const outputFilename =
      path.basename(inputTextPath, '.txt') + '__speaker_summaries.json';
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/2_speaker_summaries',
    );
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);

    console.log('speaker summaries:', speaker_summaries);

    if (speaker_summaries) {
      fs.writeFile(outputFilePath, speaker_summaries);
    }

  } catch (error) {
    console.error('Error processing .txt file:', error);
  }
}

async function processAllDocxFiles(inputDirectoryPath: string): Promise<void> {
  try {
    const files = await fs.readdir(inputDirectoryPath);
    const textFiles = files.filter(
      (file: string) => path.extname(file) === '.txt',
    );

    // Skip the first 3 files
    let docsCount = 0;

    for (const textFile of textFiles) {
      // if (docsCount < 4) {
      //   docsCount++;
      //   continue;
      // }

      const inputTextPath = path.join(inputDirectoryPath, textFile);

      const outputFilename =
        path.basename(inputTextPath, '.txt') + '__speaker_summaries.json';
      const outputDirectoryPath = path.join(
        process.cwd(),
        'scripts/2_speaker_summaries',
      );
      const outputFilePath = path.join(outputDirectoryPath, outputFilename);

      let processed = true;
      try {
        await fs.stat(outputFilePath);
      } catch (err) {
        processed = false;
      }

      console.log('PROCESSED:', processed);

      // Check if the file has already been processed
      if (processed) {
        console.log('File already processed:', outputFilePath);
        continue;
      }

      await processDocxFile(inputTextPath);
      return;
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }
}

export const run = async () => {
  try {
    // Create an absolute path to the relative path of "docs/Without Timestamps"
    const inputDirectoryPath = path.join(
      process.cwd(),
      'scripts/1_labeled_transcripts',
    );
    console.log('DOCS PATH', inputDirectoryPath);
    await processAllDocxFiles(inputDirectoryPath);
  } catch (error) {
    console.log('error', error);
    throw new Error('Failed to extract links');
  }
};

(async () => {
  const startTime = Date.now();
  console.log('process.cwd()', process.cwd());
  await run();

  // const newObj = replaceKeyInObject('_.summary', '_.speaker_content', speakerSummaries);

  // console.log('newObj', newObj);
  const endTime = Date.now();

  console.log('Total token usage:', getGlobalTokenCount());
  console.log('Total time: ', (endTime - startTime) / 1000, 'seconds');

  console.log('extraction complete');
})();
