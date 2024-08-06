import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import { OpenAI } from 'langchain/llms/openai';
import { LLMChain } from 'langchain/chains';
import { PromptTemplate } from 'langchain/prompts';
import { countAllTokens } from './count-tokens';

// Function that removes all characters before the first '['
const removeTextBeforeFirstBracket = (text: string) => {
  const firstBracketIndex = text.indexOf('[');
  if (firstBracketIndex === -1) {
    return text;
  }
  return text.substring(firstBracketIndex);
};

const parsePartialJson = (input: string) => {
  let jsonString = input;
  console.log('TEXT:', jsonString);
  let stack = [];

  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString[i];

    if (char === '[' || char === '{') {
      stack.push(char);
    } else if (char === '}' || char === ']') {
      const lastInStack = stack.pop();

      if (
        (char === '}' && lastInStack !== '{') ||
        (char === ']' && lastInStack !== '[')
      ) {
        jsonString = jsonString.slice(0, i);
        break;
      }
    }
  }

  while (stack.length > 0) {
    const popped = stack.pop();
    if (popped === '{') {
      const lastOpeningBrace = jsonString.lastIndexOf('{');
      jsonString = jsonString.slice(0, lastOpeningBrace);
    } else {
      jsonString += ']';
    }
  }

  // Remove trailing comma
  const regex = /,\s*([}\]])/g;
  jsonString = jsonString.replace(regex, '$1');

  // Delete all text after the last closing bracket
  const lastClosingBracket = jsonString.lastIndexOf('}');
  jsonString = jsonString.slice(0, lastClosingBracket + 1);

  try {
    // console.log('JSON:', jsonString);
    const jsonObject = JSON.parse(jsonString);
    return jsonObject;
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return null;
  }
};

const splitTextIntoChunks = (
  text: string,
  maxChars: number,
  overlap: number,
) => {
  let chunks = [];
  let index = 0;

  while (index < text.length) {
    let endIndex = index + maxChars;

    chunks.push(text.slice(index, endIndex));

    if (endIndex < text.length) {
      endIndex -= overlap; // Adjust the endIndex to include the overlap
    }
    index = endIndex;
  }

  return chunks;
};

const generateLabeledTranscript = async (speaker_descriptions: any, text: string, overlap = 500) => {
  const maxChars = 5000; // Adjust this value based on the model's token limit
  const textChunks = splitTextIntoChunks(text, maxChars, overlap);

  let allLabeledChunks: any[] = [];

  let chunkCount = 0;
  for (const chunk of textChunks) {
    console.log('CHUNK:', chunk);

    const LABEL_PROMPT =
      PromptTemplate.fromTemplate(`Using the provided speaker descriptions and transcript portion, please extract and label the FIRST FEW WORDS spoken by each speaker in the transcript. Use the speaker names for labels. Note that not every speaker will be present in every transcript portion.

      For instance, given the example speaker descriptions and transcript portion:
      
      ---
      
      Speaker Description Example:
      
      {{
        "speaker1": {{
            "name": "Tom Campbell",
            "speech_pattern": "Clear and articulate",
            .
            .
            .
        }},
        "speaker2": {{
            "name": "Sally Smith",
            "speech_pattern": "Fast and mumbly",
            .
            .
            .
        }}
      }}
      
      Transcript Portion Example:
      
      Hi Tom, how are you doing today? Do you feel better? I'm doing well, thanks for asking. How are you doing Sally?
      
      ---
      
      Your response should be:
      
      ---
      
      Sally Smith:: Hi Tom, how are you doing today?
      Tom Campbell:: I'm doing well, thanks for asking.
      
      ---
      
      Please focus on EXTRACTING and LABELING the FIRST FEW WORDS of each speaker's speech ONLY.
      
      Speaker Descriptions:
      {speaker_descriptions}
      
      Transcript Portion:
      {transcript_chunk}
    `);

    const labelChain = new LLMChain({
      llm: new OpenAI(
        { temperature: 0, maxTokens: 1500, modelName: 'gpt-4o-mini' },
        { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' },
      ),
      prompt: LABEL_PROMPT,
    });

    const prompt_example = await LABEL_PROMPT.format({
      transcript_chunk: 'test_transcripts',
      speaker_descriptions,
    });

    console.log('PROMPT example:', prompt_example);

    try {
      console.log(
        'INPUT TOKENS:',
        countAllTokens(LABEL_PROMPT, chunk, speaker_descriptions),
      );
      const response = await labelChain.call({
        transcript_chunk: chunk,
        speaker_descriptions,
      });

      const labeledChunk = response.text;

      console.log('OUTPUT TOKENS:', countAllTokens(labeledChunk));

      console.log(
        'TOTAL TOKENS:',
        countAllTokens(LABEL_PROMPT, chunk, speaker_descriptions, labeledChunk),
      );

      console.log('Labeled chunk:', labeledChunk);

      allLabeledChunks = allLabeledChunks.concat(labeledChunk);

      chunkCount++;

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
      console.error('Error details: ', error?.data?.error);
      return null;
    }

    // return allLabeledChunks;
  }

  return allLabeledChunks;
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
      path.basename(inputDocxPath, '.docx') + '__transcript_labels.json';
    const labelDirectoryPath = path.join(
      process.cwd(),
      'scripts/transcript_labels',
    );
    const labelFilePath = path.join(labelDirectoryPath, labelFilename);

    const labelData = await fs.readFile(labelFilePath, 'utf8');
    const labelJson = JSON.parse(labelData);
    // Grab the last element of the array, which is the most recent label
    const labelDescriptions = JSON.stringify(labelJson[labelJson.length - 1], null, 4);

    const outputFilename =
      path.basename(inputDocxPath, '.docx') + '__labeled_chunks.json';
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/labeled_chunks',
    );
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);

    await generateLabeledTranscript(labelDescriptions, text).then((allLabledChunks) => {
      // get current workding directory with path

      if (allLabledChunks) {
        fs.writeFile(outputFilePath, JSON.stringify(allLabledChunks, null, 2));
      }
    });
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
      if (docsCount < 3) {
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
  console.log('process.cwd()', process.cwd());
  await run();

  console.log('extraction complete');
})();
