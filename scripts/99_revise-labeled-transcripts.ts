import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import { OpenAI } from 'langchain/llms/openai';
import { LLMChain } from 'langchain/chains';
import { PromptTemplate } from 'langchain/prompts';
import { countTokens, countAllTokens } from './count-tokens';

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

const generateLabeledTranscript = async (speaker_descriptions: any, text: string[]) => {
  // const maxChars = 5000; // Adjust this value based on the model's token limit
  // const textChunks = splitTextIntoChunks(text, maxChars, overlap);

  let allLabeledChunks: any[] = [];

  console.log("TEXT:", text.join('\n\n\n'), '\n\n')

  let chunkCount = 0;
  for (const chunk of text) {
    console.log('CHUNK:', chunk, '\n\n');


    // Please analyze the given speaker descriptions and the labeled transcript portion. Determine if the labels in the transcript portion are correct or incorrect based on the speaker descriptions. If the labels are incorrect, provide the corrected labeled transcript portion with proper formatting, separating different speakers with a blank line and using the speaker labels followed by two colons (::) before the speaker's text. Do not introduce new content or split the portion if it is actually a single speaker. If the labels are correct, simply return the original transcript portion.


    const LABEL_PROMPT = PromptTemplate.fromTemplate(`
    Using the given speaker descriptions, please analyze the speaker characteristics in the provided labeled transcript portion. Compare the characteristics detected in the transcript portion to the provided speaker descriptions. Pay close attention to each speaker's speech pattern, pronunciation and accent, tone and pitch, speaking tempo, pauses and hesitations, grammatical structures and errors, context and content, and any other available information. With these details in mind, verify the correctness of the labels in the provided labeled transcript portion. If the portion contains two speakers but is labeled as one, correct the labels accordingly. If the portion is labeled with the wrong speaker, update the label. Please avoid introducing new content or incorrectly splitting a portion when it is actually a single speaker. If there is no content for a speaker, do not include any label for that speaker. Do not include any additional notes or comments in the output.

    The final output should be a report of the speaker characteristics detected in this portion and how they compare to the provided speaker descriptions, followed by the corrected labeled transcript portion if any errors are found, otherwise, return the original portion.

    If a particular portion has consistent characterizations throughout, make sure to verify that the labels are correct for the entire portion. If the portion has inconsistent characterizations, please make sure to verify that the labels are correct for each speaker's portion.

    When providing the corrected labeled transcript portion, please make sure to:

    1. Separate different speakers with a blank line.
    2. Use the speaker labels followed by two colons (::) before the speaker's text.

    ALWAYS return either the original or corrected transcript portion.

    Speaker descriptions:
    ---
    {speaker_descriptions}
    ---

    Labeled transcript portion:
    ---
    {transcript_chunk}
    ---

    The output should follow the EXACT format:

    --- SPEAKER CHARACTERISTICS DETECTED IN THIS PORTION AND THEIR COMPARISON TO THE PROVIDED DESCRIPTIONS ---
    <report of speaker characteristics detected in the transcript portion and how they compare to the provided speaker descriptions>
    --- CORRECTED OR ORIGINAL LABELED TRANSCRIPT PORTION ---
    <corrected labeled transcript portion OR the original portion if no errors were detected>
    `)

    // const LABEL_PROMPT =
    //   PromptTemplate.fromTemplate(`Using the provided speaker descriptions and labeled transcript portion, please CAREFULLY analyze the labeled portion to verify that the speaker label is correct. Take into consideration all of the various speaker description content when analyzing. If the label is incorrect, please assign the correct speaker. If there are multiple speakers, please assign the correct speaker label to the beginning of each spoken portion. If one of the speakers from the description does not speak, do NOT add their label. If there is any doubt, make NO changes. Extract and label ONLY the FIRST FEW WORDS spoken by each speaker in the transcript.

    //   For instance, given the example speaker descriptions and transcript portion:
      
    //   ---
      
    //   Speaker Description Example:
      
    //   {{
    //     "speaker1": {{
    //         "name": "Tom Campbell",
    //         "speech_pattern": "Clear and articulate",
    //         .
    //         .
    //         .
    //     }},
    //     "speaker2": {{
    //         "name": "Sally Smith",
    //         "speech_pattern": "Fast and mumbly",
    //         .
    //         .
    //         .
    //     }}
    //   }}
      
    //   Transcript Portion Example:
      
    //   Tom Campbell:: Hi Tom, how are you doing today? Do you feel better? I'm doing well, thanks for asking. How are you doing Sally?
      
    //   ---
      
    //   Your response should be:
      
    //   ---
      
    //   Sally Smith:: Hi Tom, how are you doing today?

    //   Tom Campbell:: I'm doing well, thanks for asking.
      
    //   ---
      
    //   Please focus on EXTRACTING and LABELING the FIRST FEW WORDS of each speaker's speech ONLY. DO NOT ADD CONTENT to the transcript. DO NOT ADD SPEAKERS to the transcript. DO NOT ADD SPEECH to the transcript. DO NOT ADD PUNCTUATION to the transcript. DO NOT ADD ANYTHING to the transcript. ONLY EXTRACT and LABEL the FIRST FEW WORDS of each speaker's speech.
      
    //   Speaker Descriptions:
    //   {speaker_descriptions}
      
    //   Transcript Portion:
    //   {transcript_chunk}
    // `);

    const labelChain = new LLMChain({
      llm: new OpenAI(
        { temperature: 0, maxTokens: 1500, modelName: 'gpt-4o-mini' },
        { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' },
      ),
      prompt: LABEL_PROMPT,
    });

    // const prompt_example = await LABEL_PROMPT.format({
    //   transcript_chunk: 'test_transcripts',
    //   speaker_descriptions,
    // });

    // console.log('PROMPT example:', prompt_example);

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

      console.log('Labeled chunk:\n\n', labeledChunk, '\n\n\n');

      allLabeledChunks = allLabeledChunks.concat(labeledChunk);

      chunkCount++;

      // if (chunkCount > 4) {
      //   break;
      // }

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

  // console.log("LABLED CHUNKS:\n\n", allLabeledChunks, '\n\n\n')
  // console.log("REVISED LABLED CHUNKS:\n\n", fixIncorrectLabels(combineOverlappingLabels(allLabeledChunks.join('\n\n'))), '\n\n\n')

  // return fixIncorrectLabels(combineOverlappingLabels(allLabeledChunks.join('\n\n')));
  return allLabeledChunks
};


const combineOverlappingLabels = (transcript: string) => {
  const lines = transcript.split('\n\n');
  let combinedTranscript = lines[0];

  for (let i = 1; i < lines.length; i++) {
    const prevLine = lines[i - 1];
    const currentLine = lines[i];

    const prevSpeakerIndex = prevLine.indexOf('::');
    const currentSpeakerIndex = currentLine.indexOf('::');

    const prevSpeaker = prevLine.slice(0, prevSpeakerIndex + 2);
    const currentSpeaker = currentLine.slice(0, currentSpeakerIndex + 2);

    const prevContent = prevLine.slice(prevSpeakerIndex + 2).trim();
    const currentContent = currentLine.slice(currentSpeakerIndex + 2).trim();

    if (prevSpeaker === currentSpeaker) {
      combinedTranscript += ' ' + currentContent;
    } else {
      combinedTranscript += '\n\n' + currentSpeaker + ' ' + currentContent;
    }
  }

  return combinedTranscript;
};

const fixIncorrectLabels = (transcript: string) => {
  const lines = transcript.split('\n').filter(line => line.trim() !== '');
  let intermediateLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    if (nextLine) {
      const currentSpeaker = line.match(/^(.+?)::/)?.[1] || '';
      const nextSpeaker = nextLine.match(/^(.+?)::/)?.[1] || '';

      const currentContent = line.slice(currentSpeaker.length + 2).trim();
      const nextContent = nextLine.slice(nextSpeaker.length + 2).trim();

      if (
        !currentContent.endsWith('.') &&
        !currentContent.endsWith('?') &&
        !currentContent.endsWith('!') &&
        currentSpeaker &&
        nextSpeaker
      ) {
        intermediateLines.push(`${currentSpeaker}:: ${currentContent}${nextContent}`);
        i++; // Skip next line since it's merged with the current line
      } else {
        intermediateLines.push(line);
      }
    } else {
      intermediateLines.push(line); // Add the last line as it is
    }
  }

  let correctedLines = [];

  for (let i = 0; i < intermediateLines.length; i++) {
    const line = intermediateLines[i];
    const nextLine = intermediateLines[i + 1];

    if (nextLine) {
      const currentSpeaker = line.match(/^(.+?)::/)?.[1] || '';
      const nextSpeaker = nextLine.match(/^(.+?)::/)?.[1] || '';

      const currentContent = line.slice(currentSpeaker.length + 2).trim();
      const nextContent = nextLine.slice(nextSpeaker.length + 2).trim();

      if (currentSpeaker === nextSpeaker) {
        correctedLines.push(`${currentSpeaker}:: ${currentContent} ${nextContent}`);
        i++; // Skip next line since it's merged with the current line
      } else {
        correctedLines.push(line);
        // correctedLines.push(''); // Add an extra newline between different speakers
      }
    } else {
      correctedLines.push(line); // Add the last line as it is
    }
  }

  return correctedLines.join('\n\n');
};


const splitTranscriptPortion = (transcriptPortion: string, tokenThreshold = 750): string[] => {
  const speaker = transcriptPortion.match(/^(.+?)::/)?.[1] || '';
  const content = transcriptPortion.slice(speaker.length + 2).trim();

  if (countTokens(content) <= tokenThreshold) {
    return [transcriptPortion];
  }

  const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
  let indexToSplit = Math.floor(sentences.length / 2);

  const firstPartSentences = sentences.slice(0, indexToSplit).join('').trim();
  const secondPartSentences = sentences.slice(indexToSplit).join('').trim();

  let firstPortion = [`${speaker}:: ${firstPartSentences}`];
  let secondPortion = [`${speaker}:: ${secondPartSentences}`];

  if (countTokens(firstPortion[0]) > tokenThreshold) {
    firstPortion = splitTranscriptPortion(firstPortion[0], tokenThreshold).flat();
  }
  if (countTokens(secondPortion[0]) > tokenThreshold) {
    secondPortion = splitTranscriptPortion(secondPortion[0], tokenThreshold).flat();
  }

  return [
    ...firstPortion,
    ...secondPortion
  ]

  // return [
  //   `${speaker}:: ${firstPartSentences}...`,
  //   `${speaker}:: ${secondPartSentences}`
  // ];
};


async function processDocxFile(inputDocxPath: string) {
  try {
    // let { value: text } = await mammoth.convertToHtml({
    //   path: inputDocxPath,
    // });

    // First replace all instances of </p><p> with a newline
    // Then replace all instances of <p> and </p> with nothing
    // Then replace all instances of <br> with a newline

    // text = text.replace(/<\/p><p>/g, '\n');
    // text = text.replace(/<p>/g, '');

    //print first 10 lines of text
    // console.log("TEXT:", text.split('\n').slice(0, 10).join('\n'));

    // Extract filename from inputDocxPath, and use it as the output filename plus _qa.json. Save in "qa" directory
    const transcriptFilename =
      path.basename(inputDocxPath, '.docx') + '__labeled_transcript.json';
    const transcriptDirectoryPath = path.join(
      process.cwd(),
      'scripts/labeled_transcripts',
    );
    const transcriptFilePath = path.join(transcriptDirectoryPath, transcriptFilename);

    const transcriptData = await fs.readFile(transcriptFilePath, 'utf8');
    let labeledTranscript = transcriptData.split('\\n\\n').map((line: string) => line.trim());

    // console.log("BEFORE: \n\n\n", labeledTranscript)

    labeledTranscript = labeledTranscript.map((line: string) => splitTranscriptPortion(line)).flat();


    // console.log("AFTER: \n\n\n", labeledTranscript)

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
      path.basename(inputDocxPath, '.docx') + '__revised_labeled_transcript.json';
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/revised_labeled_transcripts',
    );
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);

    await generateLabeledTranscript(labelDescriptions, labeledTranscript).then((allLabledChunks) => {
      // get current workding directory with path

      if (allLabledChunks) {
        console.log("'\n\n\nALL LABELED CHUNKS: ", allLabledChunks, "\n\n\n'")
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
