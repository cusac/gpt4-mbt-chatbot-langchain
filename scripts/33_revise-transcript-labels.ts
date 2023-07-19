import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import { PromptTemplate } from 'langchain/prompts';
import {
  parsePartialJson,
  splitTextIntoChunks,
  countAllTokens,
  callChain,
  limitTokens,
  getGlobalTokenCount,
} from './0_utils';

// const parsePartialJson = (input: string) => {
//   let jsonString = input;
//   console.log('TEXT:', jsonString);
//   let stack = [];

//   for (let i = 0; i < jsonString.length; i++) {
//     const char = jsonString[i];

//     if (char === '[' || char === '{') {
//       stack.push(char);
//     } else if (char === '}' || char === ']') {
//       const lastInStack = stack.pop();

//       if (
//         (char === '}' && lastInStack !== '{') ||
//         (char === ']' && lastInStack !== '[')
//       ) {
//         jsonString = jsonString.slice(0, i);
//         break;
//       }
//     }
//   }

//   while (stack.length > 0) {
//     const popped = stack.pop();
//     if (popped === '{') {
//       const lastOpeningBrace = jsonString.lastIndexOf('{');
//       jsonString = jsonString.slice(0, lastOpeningBrace);
//     } else {
//       jsonString += ']';
//     }
//   }

//   // Remove trailing comma
//   const regex = /,\s*([}\]])/g;
//   jsonString = jsonString.replace(regex, '$1');

//   // Delete all text after the last closing bracket
//   const lastClosingBracket = jsonString.lastIndexOf('}');
//   jsonString = jsonString.slice(0, lastClosingBracket + 1);

//   try {
//     // console.log('JSON:', jsonString);
//     const jsonObject = JSON.parse(jsonString);
//     return jsonObject;
//   } catch (error) {
//     console.error('Error parsing JSON:', error);
//     return null;
//   }
// };

const reviseSpeakerLabels = async (
  text: string,
  speaker_analysis: string,
  overlap = 50,
) => {
  const maxChars = 2000; // Adjust this value based on the model's token limit
  const textChunks = splitTextIntoChunks(text, maxChars, overlap);

  let allLabeledChunks: any[] = [];

  let original_speaker_analysis = JSON.parse(speaker_analysis);

  if (!speaker_analysis) {
    throw new Error('No speaker analysis provided');
  }

  let chunkCount = 0;
  for (const chunk of textChunks) {
    console.log('CHUNK:', chunk);

    const LABEL_PROMPT =
      PromptTemplate.fromTemplate(`Please analyze the following portion of a transcript, taking into account the existing speaker analysis provided. Your task is to UPDATE and IMPROVE the speaker analysis while PRESERVING all relevant information from previous analysis. Focus on refining and improving the analysis based on the new information in the transcript portion. Be sure to integrate previous analysis so nothing critical is lost. The analysis should reflect the accumulated knowledge from the entire transcript up to this point. The end goal is to have a complete and consistent analyses of each speaker after all of the portions have been analyzed. ONLY analyze speech patterns, pronunciation and accent, tone and pitch, speaking tempo, pauses and hesitations, and grammatical structures and errors, vocabulary and word choice, sentence length and complexity, rhetorical devices, emotional expression, and interruption and overlaps. Try to provide at least 2 sentences per field. Be very detailed and specific but do NOT include the "context_and_content" field in your response in ANY of the fields. Only use that field to help inform your analysis.


    Existing Speaker Analysis:
    {speaker_analysis}
    
    Transcript Portion:
    {transcript_chunk}

     
    IMPORTANT: Provide your response as a SINGLE JSON object that can be parsed without errors. Do not include multiple JSON objects.


    The response should ONLY be a SINGLE VALID (i.e. parsable) JSON object with the updated speaker analysis in the following format (each speaker will have similar fields and ALL speakers will OMIT the "context_and_content" field):
    ---
    {{
      "speaker1": {{
        "name": "...",
        "speech_pattern": "...",
        "pronunciation_and_accent": "...t",
        "tone_and_pitch": "...",
        "speaking_tempo": "...",
        "pauses_and_hesitations": "...",
        "grammatical_structures_and_errors": "...",
        "vocab_and_word_choice": "...",
        "sentence_length_and_complexity": "...",
        "rhetorical_devices": "...",
        "emotional_expression": "...",
        "interuptions_and_overlaps": "..."
      }},
      "speaker2": {{ // OPTIONAL
        .
        .
        .
      }},
      "speaker3": {{ // OPTIONAL
        .
        .
        .
      }}
      // MAX 3 speakers with similar fields as needed
    }}
    ---
    NOTE: If more than 3 speakers are found, please only include the first 3 in the response.
    IMPORTANT: Please do NOT include more than 3 speakers in the response (i.e. NO "speaker4" field).
    IMPORTANT: END THE RESPONSE AFTER THE CLOSING BRACKET OF THE FIRST COMPLETE JSON OBJECT.
    `);

    const prompt_example = await LABEL_PROMPT.format({
      transcript_chunk: 'test_transcripts',
      speaker_analysis,
    });

    console.log('PROMPT example:', prompt_example);

    try {
      const response = await callChain(LABEL_PROMPT, 1500, {
        transcript_chunk: chunk,
        speaker_analysis,
      });

      const labeledChunk = await limitTokens(
        parsePartialJson(response.text),
        900,
        50,
      );

      console.log('Labeled chunk:', labeledChunk);

      for (const speaker in labeledChunk) {
        labeledChunk[speaker].context_and_content =
          original_speaker_analysis[speaker].context_and_content;
      }

      allLabeledChunks = allLabeledChunks.concat(labeledChunk);

      speaker_analysis = JSON.stringify(labeledChunk, null, 4);

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
      console.error('Error details: ', error?.response?.data?.error);
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

    let labelDescriptions;

    try {
      const labelFilename =
        path.basename(inputDocxPath, '.docx') + '__transcript_labels.json';
      const labelDirectoryPath = path.join(
        process.cwd(),
        'scripts/2_transcript_labels',
      );
      const labelFilePath = path.join(labelDirectoryPath, labelFilename);

      const labelData = await fs.readFile(labelFilePath, 'utf8');
      const labelJson = JSON.parse(labelData);
      // Grab the last element of the array, which is the most recent label
      labelDescriptions = JSON.stringify(
        labelJson[labelJson.length - 1],
        null,
        4,
      );
    } catch (err) {
      console.error('Error reading label file:', err);
    }

    await reviseSpeakerLabels(text, labelDescriptions!).then(
      (allLabledChunks) => {
        // get current workding directory with path

        // Extract filename from inputDocxPath, and use it as the output filename plus _qa.json. Save in "qa" directory
        const outputFilename =
          path.basename(inputDocxPath, '.docx') +
          '__revised_transcript_labels.json';
        const outputDirectoryPath = path.join(
          process.cwd(),
          'scripts/3_revised_transcript_labels',
        );
        const outputFilePath = path.join(outputDirectoryPath, outputFilename);

        if (allLabledChunks) {
          fs.writeFile(
            outputFilePath,
            JSON.stringify(allLabledChunks, null, 2),
          );
        }
      },
    );
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
