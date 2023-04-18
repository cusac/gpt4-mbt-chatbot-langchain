import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import { OpenAI } from 'langchain/llms/openai';
import { LLMChain, ChatVectorDBQAChain, loadQAChain } from 'langchain/chains';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { PromptTemplate } from 'langchain/prompts';
import { CallbackManager } from 'langchain/callbacks';


// Function that takes in QA json and passes it to OpenAI to improve the results
const improveQAJson = async (qaJson: any) => {
  const QA_REVISE_PROMPT = PromptTemplate.fromTemplate(`
  You have been provided with a JSON object containing question and answer pairs generated from a conversation transcript, which was created using the following prompt:

  "Please convert the following conversation transcript into a JSON object containing question and answer pairs. The JSON object should be an array of objects, where each object contains a "Q" and "A" field. Each question should be a standalone sentence, and each answer should be a standalone paragraph. In other words, each question and answer should not refer to other questions or answers. If the conversation doesn't naturally contain questions and answers, infer them based on the context. All answer text should be in the first person, mimicking the speaker's perspective."
  
  Please review all the resulting Q/A pairs in the JSON object and improve the results using the following criteria:
  
  1) Fix any grammatical errors.
  2) Improve answers to make sense without needing external context (while still preserving the intent of the answer).
  
  Emphasize on ensuring the best results possible, taking into consideration the limits of GPT-3. The final output should be an updated JSON object containing the revised question and answer pairs.
  
  Here is the JSON object containing the Q/A pairs:
  
  {input_JSON_object}
  

`);
  const qaChain = new LLMChain({
    //@ts-ignore
    llm: new OpenAI({ temperature: 0, maxTokens: 2500 }),
    prompt: QA_REVISE_PROMPT,
  });

  try {
    const response = await qaChain.call({
      qaJson: JSON.stringify(qaJson),
    });

    console.log("RESPONSE:", response)

    const improvedQAJson = parsePartialJson(response as any);

    console.log("IMPROVED QA JSON:", improvedQAJson)

    return improvedQAJson;
  } catch (error) {
    console.error('Error improving QA JSON:', error);
    return null;
  }
};

const qaRawText = fs.readFile('./qa.json', 'utf8');

improveQAJson(qaRawText)

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

const parsePartialJson = (input: any) => {
  let jsonString = input.text;
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

const splitTextIntoChunks = (text: string, maxChars: number, overlap: number) => {
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

const generateQAJson = async (text: string, overlap = 1000) => {
  const maxChars = 5000; // Adjust this value based on the model's token limit
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
      llm: new OpenAI({ temperature: 0, maxTokens: 2500 }),
      prompt: QA_PROMPT,
    });

    try {
      const response = await qaChain.call({
        conversation: chunk,
      });

      const qaJson = parsePartialJson(response as any);

      allQA = allQA.concat(qaJson);

      chunkCount++;
      if (chunkCount > 1) {
        // Write the first 2 chunks to file
        fs.writeFile('./chunks.json', JSON.stringify(textChunks.slice(0, 2), null, 2));
        // fs.writeFile('./chunks.json', JSON.stringify(textChunks, null, 2));
        fs.writeFile('./qa.json', JSON.stringify(allQA, null, 2));
        break;
      }
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
      if (qaJson) {
        fs.writeFile('./output_data.json', JSON.stringify(qaJson, null, 2));
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

    for (const docxFile of docxFiles) {
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
  await run();
  console.log('extraction complete');
})();
