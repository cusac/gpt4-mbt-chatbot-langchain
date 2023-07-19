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
  limitTokens,
} from './0_utils';

let globalTokenCount = 0;
let qaLimit = 5;

type TrainingData = {
  prompt: string;
  completion: string;
};

const contstructTrainingData = (
  qaPairs: TranscriptData[],
  endIndex: number,
  conversationSummary: string,
): TrainingData => {
  let data: TrainingData = {
    prompt: `Summary:\n\n###\n${conversationSummary}\n###`,
    completion: '',
  };

  let tokenSize = 0;
  let tokenLimit = 2500;
  let pair = qaPairs[endIndex];
  let startIndex = endIndex;
  let dataDummy: any[] = [conversationSummary];

  console.log('DATA END INDEX:', endIndex);

  while (startIndex > 0 && endIndex - startIndex < qaLimit) {
    dataDummy.push(pair);
    tokenSize = countAllTokens(dataDummy, qaPairs[endIndex - 1]);
    console.log('Token Size:', tokenSize);
    if (tokenSize > tokenLimit) {
      break;
    }
    startIndex -= 1;
    pair = qaPairs[startIndex];
  }

  pair = qaPairs[startIndex];

  while (startIndex < endIndex) {
    console.log('Data Start Index:', startIndex);
    data.prompt =
      data.prompt +
      `\n\nQuestioner:\n\n###\n${pair.questioner}\n###\n\nAgent:\n\n###\n${pair.agent}\n###`;
    startIndex += 1;
    pair = qaPairs[startIndex];
  }

  data.prompt =
    data.prompt +
    `\n\nQuestioner:\n\n###\n${pair.questioner}\n###\n\nAgent:\n\n###\n`;
  data.completion = ` ${pair.agent}\n###`;

  return data;
};

const generateTrainingData = async (
  qaPairs: TranscriptData[],
  trainingData: TrainingData[],
  agent: string,
  conversationPath: string,
  outputPath: string,
) => {
  console.log('QA PAIR LENGTH:', qaPairs.length);

  let conversationSummary = 'None. This is the beginning of the conversation.';
  let summaries = [];
  let index = trainingData.length;

  console.log('INDEX:', index);

  try {
    conversationSummary = await fs.readFile(conversationPath, 'utf8');
    summaries = JSON.parse(conversationSummary);
    conversationSummary = summaries[index];
  } catch (err) {
    console.error('Error reading conversation summary file:', err);
    if (trainingData.length > 0) {
      throw err;
    }
  }

  const agentName = agent.slice(3, agent.length - 3);

  if (index === 0) {
    conversationSummary = 'None. This is the beginning of the conversation.';
  }

  while (index < qaPairs.length) {
    console.log('SET INDEX:', index);
    let nextData = contstructTrainingData(qaPairs, index, conversationSummary);
    trainingData.push(nextData);

    // TODO: pull in summary from file
    if (summaries[index]) {
      conversationSummary = summaries[index];
    } else {
      conversationSummary = await generateSummaryFromQA(
        conversationSummary,
        [qaPairs[index]],
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

      fs.writeFile(
        conversationPath,
        JSON.stringify(summaries, null, 4),
        'utf8',
      );
    }

    // console.log('CONVERSATION SUMMARY:', conversationSummary);
    // console.log('nextData:', nextData);
    // console.log('Training Set:', trainingData);

    fs.writeFile(outputPath, JSON.stringify(trainingData, null, 4), 'utf8');

    index += 1;
  }

  return trainingData;
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

    let agentDescription;

    try {
      const agentDescriptionFilename = 'agent_description.json';
      const agentDescriptionDirectoryPath = path.join(process.cwd(), 'scripts');
      const agentDescriptionFilePath = path.join(
        agentDescriptionDirectoryPath,
        agentDescriptionFilename,
      );

      agentDescription = await fs.readFile(agentDescriptionFilePath, 'utf8');
      agentDescription = JSON.parse(agentDescription);
    } catch (err) {
      console.error('Error reading agent description file:', err);
    }

    const outputFilename =
      path.basename(inputPath, '.txt') +
      `__training_data_standard_qa_${qaLimit}.json`;
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/7_training-data',
    );
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);

    const conversationFilename =
      path.basename(inputPath, '.txt') + '__qa_summary.txt';
    const conversatiotDirectoryPath = path.join(process.cwd(), 'scripts/5_qa');
    const conversationFilePath = path.join(
      conversatiotDirectoryPath,
      conversationFilename,
    );

    let processed = true;
    let trainingData: TrainingData[] = [];
    // Support resuming processing of a file
    try {
      let trainingDataText = await fs.readFile(outputFilePath, 'utf8');
      trainingData = JSON.parse(trainingDataText);
      let numberProcessed = trainingData.length;

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

    agentName = `XXX${agentName}XXX`;

    console.log('AGENT NAME:', agentName);

    if (!agentName) {
      console.error('No agent name found in agent description file');
      return;
    }

    trainingData = await generateTrainingData(
      qaPairs,
      trainingData,
      agentName,
      conversationFilePath,
      outputFilePath,
    );

    fs.writeFile(outputFilePath, JSON.stringify(trainingData, null, 4));
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
