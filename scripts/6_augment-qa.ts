import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
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
  limitTokens
} from './0_utils';

let globalTokenCount = 0;

const generateQA = async (qaPairs: TranscriptData[], agent: string, augmentedQaPairs: TranscriptData[], conversationPath: string, outputPath: string) => {
  console.log("QA PAIR LENGTH:", qaPairs.length)

  let conversationSummary = '';
  let summaries = [];

  if (augmentedQaPairs.length === 0) {
    conversationSummary = 'None. This is the beginning of the conversation.';
  } else {
    try {
      conversationSummary = await fs.readFile(conversationPath, 'utf8');
    } catch (err) {
      console.error('Error reading conversation summary file:', err);
      throw err;
    }  
  }

  const agentName = agent.slice(3, agent.length - 3);

  let numberProcessed = augmentedQaPairs.length;
  let currentNumberProcessed = 0;

  for (const pair of qaPairs) {
    if (currentNumberProcessed < numberProcessed) {
      currentNumberProcessed += 1;
      continue;
    }
    let augmentedQaPair = await generateAugmentedQa_1(
      pair,
      conversationSummary,
    );
    conversationSummary = await generateSummaryFromQA(
      conversationSummary,
      [augmentedQaPair],
      agentName,
    );

    const limitedSummaryObject = await limitTokens(
      { summary: conversationSummary },
      800,
      800,
      5,
    );

    conversationSummary = limitedSummaryObject.summary;
    summaries.push(conversationSummary);

    fs.writeFile(conversationPath, JSON.stringify(summaries, null, 4), 'utf8');

    augmentedQaPair = parsePartialJson(augmentedQaPair)
    console.log('CONVERSATION SUMMARY:', conversationSummary);
    console.log('PAIR:', pair);
    console.log('GENERATED QA:', augmentedQaPair);
    augmentedQaPairs.push(augmentedQaPair);
    console.log('AUGMENTED QA PAIRS:', augmentedQaPairs);

    fs.writeFile(outputPath, JSON.stringify(augmentedQaPairs), 'utf8');
  }

  return augmentedQaPairs;
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

    let qaPairs: TranscriptData[]  = JSON.parse(text)

    let agentDescription;

    try {
      const agentDescriptionFilename = 'agent_description.json';
      const agentDescriptionDirectoryPath = path.join(
        process.cwd(),
        'scripts',
      );
      const agentDescriptionFilePath = path.join(agentDescriptionDirectoryPath, agentDescriptionFilename);

      agentDescription = await fs.readFile(agentDescriptionFilePath, 'utf8');
      agentDescription = JSON.parse(agentDescription);

    } catch (err) {
      console.error('Error reading agent description file:', err);
    }

    const outputFilename =
      path.basename(inputPath, '.txt') + '__qa_augmented.json';
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/6_qa_augmented',
    );
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);

    const conversationFilename =
      path.basename(inputPath, '.txt') + '__qa_augmented_summary.txt';
    const conversatiotDirectoryPath = path.join(
      process.cwd(),
      'scripts/6_qa_augmented',
    );
    const conversatioFilePath = path.join(conversatiotDirectoryPath, conversationFilename);

    let processed = true;
    let augmentedQaPairs: TranscriptData[] = [];
    // Support resuming processing of a file
    try {
      let augmentedData = await fs.readFile(outputFilePath, 'utf8');
      augmentedQaPairs = JSON.parse(augmentedData);
      let numberProcessed = augmentedQaPairs.length;

      if (numberProcessed < qaPairs.length) {
        processed = false;
      }
    } catch (err) {
      processed = false;
    }

    console.log('PROCESSED:', processed);

    // Check if the file has already been processed
    if (processed) {
      console.log('File already processed:', outputFilePath);
      return;
    }

    let agentName = Object.keys(agentDescription)[0];

    agentName = `XXX${agentName}XXX`

    console.log("AGENT NAME:", agentName)

    if (!agentName) {
      console.error('No agent name found in agent description file');
      return;
    }

    augmentedQaPairs = await generateQA(qaPairs, agentName, augmentedQaPairs, conversatioFilePath, outputFilePath)


    fs.writeFile(outputFilePath, JSON.stringify(augmentedQaPairs, null, 4));
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
