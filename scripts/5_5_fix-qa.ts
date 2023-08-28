import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

import { OpenAI } from 'langchain/llms/openai';
import { LLMChain } from 'langchain/chains';
import { PromptTemplate } from 'langchain/prompts';
import { countAllTokens } from './count-tokens';
import {
  callChain,
  getHighestNameCounts,
  getGlobalTokenCount,
  countTokens,
  extractQAPairs,
  replaceSpeakerLabels,
  splitTranscript,
  processQA,
  generateSummaryFromQA,
  TranscriptData,
  generateAugmentedQa_1,
  parsePartialJson,
  limitTokens,
  isPartial,
  completeString,
  getLastSentences,
  removeThreeDotsFromEnd,
  replaceSubstring,
} from './0_utils_alt';

const fixQaPair = async (qaPair: TranscriptData) => {
  const { questioner, agent } = qaPair;
  let fixedQaPair: TranscriptData = { questioner, agent: '' };

  if (isPartial(agent)) {
    console.log('ORIGINAL:', agent);
    let lastSentences = getLastSentences(agent, 4);
    const fixedSubstring = await completeString(lastSentences);
    lastSentences = removeThreeDotsFromEnd(lastSentences);
    fixedQaPair.agent = replaceSubstring(
      removeThreeDotsFromEnd(agent),
      lastSentences,
      fixedSubstring,
    );
    console.log('FIXED:', fixedQaPair.agent);
  } else {
    fixedQaPair.agent = agent;
  }

  return fixedQaPair;
};

const fixQa = async (qaPairs: TranscriptData[], outputPath: string) => {
  console.log('QA PAIR LENGTH:', qaPairs.length);

  const fixedQaPairs: TranscriptData[] = [];

  for (const qaPair of qaPairs) {
    const fixedPair = await fixQaPair(qaPair);
    fixedQaPairs.push(fixedPair);
  }

  await fs.writeFile(outputPath, JSON.stringify(fixedQaPairs, null, 4), 'utf8');

  return fixedQaPairs;
};
type SpeakerContent = {
  [speaker: string]: string;
};

async function processFile(inputPath: string) {
  try {
    const qaFileName = path.basename(inputPath, '.txt') + '__qa.json';
    const qaDirectoryPath = path.join(process.cwd(), 'scripts/5_qa');
    const qaFilePath = path.join(qaDirectoryPath, qaFileName);

    let text = await fs.readFile(qaFilePath, 'utf8');

    let qaPairs: TranscriptData[] = JSON.parse(text);

    const outputFilename = path.basename(inputPath, '.txt') + `__qa_fixed.json`;
    const outputDirectoryPath = path.join(process.cwd(), 'scripts/5_qa');
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);

    // Skip file if it already exists
    if (fsSync.existsSync(outputFilePath)) {
      console.log('File already exists:', outputFilePath);
      return;
    }

    const fixedQaPairs = await fixQa(qaPairs, outputFilePath);

    await fs.writeFile(outputFilePath, JSON.stringify(fixedQaPairs, null, 4));
  } catch (error) {
    console.error('Error processing file:', error);
  }
}

async function processAllFiles(inputDirectoryPath: string): Promise<void> {
  try {
    const files = await fs.readdir(inputDirectoryPath);

    // Skip the first 3 files
    let docsCount = 0;

    for (const file of files) {
      // if (docsCount < 4) {
      //   docsCount++;
      //   continue;
      // }
      const inputPath = path.join(inputDirectoryPath, file);

      await processFile(inputPath);
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
    await processAllFiles(inputDirectoryPath);
  } catch (error) {
    console.log('error', error);
    throw new Error('Failed to extract links');
  }
};

(async () => {
  const startTime = Date.now();
  console.log('process.cwd()', process.cwd());
  await run();

  const endTime = Date.now();

  console.log('Total token usage:', getGlobalTokenCount());
  console.log('Total time: ', (endTime - startTime) / 1000, 'seconds');

  console.log('extraction complete');
})();
