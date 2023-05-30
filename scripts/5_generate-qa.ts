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
  TranscriptData
} from './0_utils';

const generateQA = async (transcript: string, agent: string) => {

  const qaPairsRaw = extractQAPairs(agent, transcript)
  let qaPairs: TranscriptData[] = []
  let conversationSummary = "None. This is the beginning of the conversation."

  const agentName = agent.slice(3, agent.length - 3)

  for (const pair of qaPairsRaw) {
    const { qaPairs: latestQaPairs, conversationSummary: updatedConversationSummary } = await processQA(pair, agentName, conversationSummary, 1500, 1100)
    conversationSummary = updatedConversationSummary
    console.log("CONVERSATION SUMMARY:", conversationSummary)
    console.log("PAIR:", pair)
    console.log("GENERATED QA:", latestQaPairs)
    qaPairs = qaPairs.concat(latestQaPairs)
    console.log("QA PAIRS:", qaPairs)

    // conversationSummary = await generateSummaryFromQA(conversationSummary, latestQaPairs, agentName)
  }

  return qaPairs
};

async function processDocxFile(inputDocxPath: string) {
  try {
    let { value: text } = await mammoth.convertToHtml({
      path: inputDocxPath,
    });

    // First replace all instances of </p><p> with a newline
    // Then replace all instances of <p> and </p> with nothing
    // Then replace all instances of <br> with a newline

    text = text.replace(/<\/p><p>/g, '\n');
    text = text.replace(/<p>/g, '');

    //print first 10 lines of text
    // console.log("TEXT:", text.split('\n').slice(0, 10).join('\n'));

    // Extract filename from inputDocxPath, and use it as the output filename plus _qa.json. Save in "qa" directory
    const labelFilename =
      path.basename(inputDocxPath, '.docx') + '__named_transcript.txt';
    const labelDirectoryPath = path.join(
      process.cwd(),
      'scripts/4_named_transcripts',
    );
    const labelFilePath = path.join(labelDirectoryPath, labelFilename);

    text = await fs.readFile(labelFilePath, 'utf8');

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
      path.basename(inputDocxPath, '.docx') + '__qa.json';
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/5_qa',
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
      return;
    }

    let agentName = Object.keys(agentDescription)[0];

    agentName = `XXX${agentName}XXX`

    console.log("AGENT NAME:", agentName)

    // console.log("TEXT:", text)

    if (!agentName) {
      console.error('No agent name found in agent description file');
      return;
    }

    const qaPairs = await generateQA(text, agentName)


    fs.writeFile(outputFilePath, JSON.stringify(qaPairs, null, 4));

  } catch (error) {
    console.error('Error processing .docx file:', error);
  }
}

async function processAllDocxFiles(inputDirectoryPath: string): Promise<void> {
  try {
    const files = await fs.readdir(inputDirectoryPath);
    const docxFiles = files.filter(
      (file: string) => path.extname(file) === '.docx',
    );

    // Skip the first 3 files
    let docsCount = 0;

    for (const docxFile of docxFiles) {
      if (docsCount < 4) {
        docsCount++;
        continue;
      }
      const inputDocxPath = path.join(inputDirectoryPath, docxFile);

      await processDocxFile(inputDocxPath);
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
      'docs/Without Timestamps',
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

  const endTime = Date.now();

  console.log('Total token usage:', getGlobalTokenCount());
  console.log('Total time: ', (endTime - startTime) / 1000, 'seconds');

  console.log('extraction complete');
})();
