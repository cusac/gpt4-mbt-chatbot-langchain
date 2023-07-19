import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import readline from 'readline';

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
  detectDuplicateSpeakers,
  mergeSpeakers,
  concatenateConsecutiveSpeakerTexts,
} from './0_utils';

let duplicateSpeakers: string[] = [];

async function processDocxFile(inputTextPath: string) {
  try {
    let text = await fs.readFile(inputTextPath, 'utf8');

    // const chunks = splitTextIntoChunks(text, 4000, 0);

    // const speakerLabels = ['SPEAKER_A', 'SPEAKER_B', 'SPEAKER_C']

    // let count = 0

    // for (const chunk of chunks) {
    //   const response = await detectDuplicateSpeakers(chunk, speakerLabels)

    //   console.log('RESPONSE:', response)

    //   count++

    //   if (count > 3) {
    //     return
    //   }
    // }

    const outputFilename =
      path.basename(inputTextPath, '.txt') + '__cleaned.txt';
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/1_z_2_cleaned_transcripts',
    );
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);


    const mergedTranscript = mergeSpeakers(text, duplicateSpeakers)
    // console.log("MERGED:\n\n", mergedTranscript)
    const concatedTranscript = concatenateConsecutiveSpeakerTexts(mergedTranscript)

    // console.log("CONCATED:\n\n", concatedTranscript)

    await fs.writeFile(outputFilePath, concatedTranscript, 'utf8');
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
        path.basename(inputTextPath, '.txt') + '__cleaned.txt';
      const outputDirectoryPath = path.join(
        process.cwd(),
        'scripts/1_z_2_cleaned_transcripts',
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

      console.log("Processing file:", inputTextPath, "\n\n")


      duplicateSpeakers = await readInSpeakerLabelsFromUser();

      console.log("Duplicate speakers:", duplicateSpeakers, "\n\n")

      if (!duplicateSpeakers[0]) {
        console.log('No duplicate speakers provided. Skipping file.');
        continue;
      }

      await processDocxFile(inputTextPath);
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }
}

// function that prompts user to input duplicate speaker labels
async function readInSpeakerLabelsFromUser() {
  const LABEL_PROMPT = `Please list the dulpicate speaker labels separated by a comma (e.g. "SPEAKER_A,SPEAKER_B").\n\nDuplicate speaker labels: (press enter to skip)`;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const labelString: string = await new Promise((resolve) => {
    rl.question(LABEL_PROMPT, (answer) => {
      rl.close();
      resolve(answer);
    });
  });

  return labelString.split(',');
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

  const endTime = Date.now();

  console.log('Total token usage:', getGlobalTokenCount());
  console.log('Total time: ', (endTime - startTime) / 1000, 'seconds');

  console.log('extraction complete');
})();
