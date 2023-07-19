import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import { PromptTemplate } from 'langchain/prompts';
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
  limitTokens,
} from './0_utils';

const generateQA = async (
  transcript: string,
  agent: string,
  index: number,
  qaPairs: TranscriptData[],
  conversationPath: string,
  outputPath: string,
  indexFilePath: string,
) => {
  const qaPairsRaw = extractQAPairs(agent, transcript);

  if (qaPairsRaw.length === 0) {
    console.error('\nNo QA pairs found.\n\n');
    return [];
  }

  let conversationSummary = 'None. This is the beginning of the conversation.';
  let summaries: string[] = [];

  try {
    conversationSummary = await fs.readFile(conversationPath, 'utf8');
    summaries = JSON.parse(conversationSummary);
    conversationSummary = summaries[summaries.length - 1];
  } catch (err) {
    console.error('Error reading conversation summary file:', err);
    if (index > 0) {
      throw err;
    }
  }

  const agentName = agent.slice(3, agent.length - 3);

  while (index < qaPairsRaw.length) {
    console.log('SET INDEX:', index);
    const pair = qaPairsRaw[index];
    const { qaPairs: latestQaPairs, summaries: latestSummaries } =
      await processQA(pair, agentName, conversationSummary, 1500, 1500);

    // conversationSummary = updatedConversationSummary
    // console.log("CONVERSATION SUMMARY:", conversationSummary)
    qaPairs = qaPairs.concat(latestQaPairs);
    summaries = summaries.concat(latestSummaries);

    console.log('CONVERSATION SUMMARY:', latestSummaries);
    console.log('PAIR:', pair);
    console.log('GENERATED QA:', latestQaPairs);
    console.log('QA PAIRS:', qaPairs);

    fs.writeFile(conversationPath, JSON.stringify(summaries, null, 4), 'utf8');

    fs.writeFile(outputPath, JSON.stringify(qaPairs, null, 4), 'utf8');

    index += 1;

    fs.writeFile(indexFilePath, index.toString(), 'utf8');
  }

  fs.writeFile(indexFilePath, 'DONE', 'utf8');

  // for (const pair of qaPairsRaw) {
  //   const { qaPairs: latestQaPairs, conversationSummary: updatedConversationSummary } = await processQA(pair, agentName, conversationSummary, 1500, 1100)
  //   conversationSummary = updatedConversationSummary
  //   console.log("CONVERSATION SUMMARY:", conversationSummary)
  //   console.log("PAIR:", pair)
  //   console.log("GENERATED QA:", latestQaPairs)
  //   qaPairs = qaPairs.concat(latestQaPairs)
  //   console.log("QA PAIRS:", qaPairs)

  //   // conversationSummary = await generateSummaryFromQA(conversationSummary, latestQaPairs, agentName)
  // }

  return qaPairs;
};

async function processFile(inputPath: string) {
  try {
    const namedTranscriptFilename =
      path.basename(inputPath, '.txt') + '__named_transcript.txt';
    const namedTranscriptDirectoryPath = path.join(
      process.cwd(),
      'scripts/4_named_transcripts',
    );
    const namedTranscriptFilePath = path.join(
      namedTranscriptDirectoryPath,
      namedTranscriptFilename,
    );

    let text = await fs.readFile(namedTranscriptFilePath, 'utf8');

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

    const outputFilename = path.basename(inputPath, '.txt') + '__qa.json';
    const outputDirectoryPath = path.join(process.cwd(), 'scripts/5_qa');
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);

    const conversationFilename =
      path.basename(inputPath, '.txt') + '__qa_summary.txt';
    const conversatiotDirectoryPath = path.join(process.cwd(), 'scripts/5_qa');
    const conversationFilePath = path.join(
      conversatiotDirectoryPath,
      conversationFilename,
    );

    const indexFilename =
      path.basename(inputPath, '.txt') + '__qa_raw_index.txt';
    const indexDirectoryPath = path.join(process.cwd(), 'scripts/5_qa');
    const indexFilePath = path.join(indexDirectoryPath, indexFilename);

    let index = 0;

    try {
      let indexString = await fs.readFile(indexFilePath, 'utf8');

      if (indexString === 'DONE') {
        console.log('\nFile already processed:', outputFilePath);
        return;
      }

      index = parseInt(indexString, 10);
    } catch (err) {}

    let qaPairs: TranscriptData[] = [];
    // Support resuming processing of a file

    if (index > 0) {
      try {
        let qaPairsText = await fs.readFile(outputFilePath, 'utf8');
        qaPairs = JSON.parse(qaPairsText);
      } catch (err) {
        throw "Couldn't read qa pairs file.";
      }
    }

    let agentName = Object.keys(agentDescription)[0];

    agentName = `XXX${agentName}XXX`;

    console.log('AGENT NAME:', agentName);

    // console.log("TEXT:", text)

    if (!agentName) {
      console.error('No agent name found in agent description file');
      return;
    }

    qaPairs = await generateQA(
      text,
      agentName,
      index,
      qaPairs,
      conversationFilePath,
      outputFilePath,
      indexFilePath,
    );

    fs.writeFile(outputFilePath, JSON.stringify(qaPairs, null, 4));
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

      console.log('\nPROCESSING FILE:', inputPath);

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
