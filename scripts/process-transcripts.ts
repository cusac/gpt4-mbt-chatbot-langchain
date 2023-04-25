import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import { OpenAI } from 'langchain/llms/openai';
import { LLMChain } from 'langchain/chains';
import { PromptTemplate } from 'langchain/prompts';

// Function that removes all characters before the first '['
const removeTextBeforeFirstBracket = (text: string) => {
  const firstBracketIndex = text.indexOf('[');
  if (firstBracketIndex === -1) {
    return text;
  }
  return text.substring(firstBracketIndex);
};

// Function that takes in QA json and passes it to OpenAI to improve the results
const improveQAJson = async (qaJson: any) => {
  const QA_REVISE_PROMPT = PromptTemplate.fromTemplate(`
  
  You have been provided with a JSON object containing question and answer pairs generated from a conversation transcript.
  
  Please review all the resulting Q/A pairs in the JSON object and improve the results using the following criteria:
  
  1) Fix any grammatical errors.
  2) Answers should not need external context.
  3) Keep the answers as close as possible to the original wording, length, tone, and style. Do NOT summarize.
  4) Ensure that each answer closely resembles the original in terms of wording, tone, style, and length (i.e. word count). Focus on maintaining the complexity and depth of the original answers. For example, if the original answer is informal and chatty, the revised answer should also be informal and chatty. If the original answer is formal and academic, the revised answer should also be formal and academic. Do NOT summarize.
  
  Emphasize on ensuring the best results possible, taking into consideration the limits of GPT-3. The final output should be an updated JSON object containing the revised question and answer pairs.

  Return ONLY the revised JSON object. In other words, your response should be a valid JSON object that can be parsed into a JavaScript object. Do NOT include any other text in your response such as "Revised JSON object:" or "Here is the revised JSON object:". Your response should ONLY be the revised JSON object.
  
  Here is the JSON object containing the Q/A pairs:
  
  {qaJson}

`);
  const qaChain = new LLMChain({
    //@ts-ignore
    llm: new OpenAI(
      { temperature: 0, maxTokens: 2500, modelName: 'text-davinci' },
      { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' },
    ),
    prompt: QA_REVISE_PROMPT,
  });

  try {
    const response = await qaChain.call({
      qaJson: JSON.stringify(qaJson),
    });

    // console.log('RESPONSE:', response);

    const improvedQAJson = parsePartialJson(
      removeTextBeforeFirstBracket(response.text),
    );

    console.log('IMPROVED QA JSON:', improvedQAJson);

    // Write to file 'qa2.json'
    await fs.writeFile('./qa2.json', JSON.stringify(improvedQAJson, null, 2));

    return improvedQAJson;
  } catch (error) {
    console.error('Error improving QA JSON:', error);
    return null;
  }
};

// dotenv.config();

// openai.apiKey = process.env.OPENAI_API_KEY;

// const splitTextIntoChunks = (text: string, maxChars: number) => {
//   const chunks = [];
//   const lines = text.trim().split('\n');
//   let currentChunk = '';

//   for (const line of lines) {
//     if (currentChunk.length + line.length + 1 > maxChars) {
//       chunks.push(currentChunk.trim());
//       currentChunk = '';
//     }
//     currentChunk += line + '\n';
//   }

//   if (currentChunk.trim()) {
//     chunks.push(currentChunk.trim());
//   }

//   return chunks;
// };

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

const generateQAJson = async (text: string, overlap = 500) => {
  const maxChars = 3000; // Adjust this value based on the model's token limit
  const textChunks = splitTextIntoChunks(text, maxChars, overlap);

  let allQA: any[] = [];

  let chunkCount = 0;
  for (const chunk of textChunks) {
    console.log('CHUNK:', chunk);

    const QA_PROMPT = PromptTemplate.fromTemplate(`
Please convert the following conversation transcript into a JSON object containing question and answer pairs. The JSON object should be an array of objects, where each object contains a "Q" and "A" field. Each question should be a standalone sentence, and each answer should be a standalone paragraph. In other words, each question and answer should not refer to other questions or answers.

{conversation}

If the conversation doesn't naturally contain questions and answers, infer them based on the context. All answer text should be in the first person, mimicking the speaker's perspective.`);

    const qaChain = new LLMChain({
      llm: new OpenAI(
        { temperature: 0, maxTokens: 2500, modelName: 'gpt-3.5-turbo' },
        { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' },
      ),
      prompt: QA_PROMPT,
    });

    try {
      const response = await qaChain.call({
        conversation: chunk,
      });

      const qaJson = parsePartialJson(response.text as any);

      allQA = allQA.concat(qaJson);

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
      console.error('Error generating QA JSON:', error);
      return null;
    }
  }

  return allQA;
};

// const generateQAJson = async (text: string) => {
//   const maxChars = 4000; // Adjust this value based on the model's token limit
//   const textChunks = splitTextIntoChunks(text, maxChars);

//   let allQA: string[] = [];

//   let chunkCount = 0;
//   for (const chunk of textChunks) {

//     console.log("CHUNK:", chunk)

// const QA_PROMPT =
// PromptTemplate.fromTemplate(`
// Please convert the following conversation transcript into a JSON object containing question and answer pairs. The JSON object should be an array of objects, where each object contains a "Q" and "A" field.

// {conversation}

// If the conversation doesn't naturally contain questions and answers, infer them based on the context. All answer text should be in the first person, mimicking the speaker's perspective.`);

//     const qaChain = new LLMChain({
//       llm: new OpenAI({ temperature: 0 }),
//       prompt: QA_PROMPT,
//     });

//     try {
//       const response = await qaChain.call({
//         conversation: chunk
//       })

//       const qaJson = parsePartialJson(response as any);

//       allQA = allQA.concat(qaJson);

//       chunkCount++;
//       if (chunkCount > 2) {
//         break;
//       }

//     } catch (error) {
//       console.error('Error generating QA JSON:', error);
//       return null;
//     }
//   }

//   return allQA;
// };

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

    await generateQAJson(text).then((qaJson) => {
      // get current workding directory with path

      // Extract filename from inputDocxPath, and use it as the output filename plus _qa.json. Save in "qa" directory
      const outputFilename = path.basename(inputDocxPath, '.docx') + '_qa.json';
      const outputDirectoryPath = path.join(process.cwd(), 'scripts/qa_jsons2');
      const outputFilePath = path.join(outputDirectoryPath, outputFilename);

      if (qaJson) {
        fs.writeFile(outputFilePath, JSON.stringify(qaJson, null, 2));
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
      // return;
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

  // const qaRawText = await fs.readFile('./qa.json', 'utf8');

  // console.log('QA RAW TEXT:', qaRawText);

  // await improveQAJson(qaRawText);

  console.log('extraction complete');
})();
