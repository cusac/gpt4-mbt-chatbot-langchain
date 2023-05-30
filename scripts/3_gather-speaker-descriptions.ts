import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

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
  transformValues,
  paraphraseString,
} from './0_utils';

const generateSpeakerDescriptions = async (
  text: string,
  speaker_summaries: string,
  overlap = 500,
) => {
  const maxSegmentChars = 1500; // Adjust this value based on the model's token limit
  const maxChunkChars = 3500;
  const labelsAndSegments = getLabeledSegmentsAndLabelsSplit(
    text,
    maxSegmentChars,
  );

  const speaker_summaries_json = JSON.parse(speaker_summaries);

  let chunks = segmentArrayToText(labelsAndSegments, maxChunkChars);

  let allLabeledChunks: any[] = [];

  let speaker_descriptions = speaker_summaries;

  let prevLabelChunk = {};

  const similarityScores = [];

  let chunkCount = 0;
  for (const chunk of chunks) {
    // let chunk = `${label}\n\n${segment}`;
    console.log('CHUNK:', chunk);

    // Consider speech patterns, pronunciation and accent, tone and pitch, speaking tempo, pauses and hesitations, grammatical structures and errors, vocabulary and word choice, and sentence length and complexity.

    // while PRESERVING all relevant information from previous descriptions

    // The end goal is to have a complete and consistent description of each speaker after all of the portions have been analyzed.

    // Also, do NOT refer directly to other speakers (i.e. "Talks to SPEAKER A", "Listens to SPEAKER B", etc) in the speaker descriptions; instead use more general terms like "the other speaker" or "the other person".

    const LABEL_PROMPT =
      PromptTemplate.fromTemplate(`Please analyze the following labeled portion of a transcript, taking into account the existing speaker descriptions provided. Your task is to UPDATE and IMPROVE the provided speaker descriptions. Be very detailed and specific and try to provide at least 2 sentences per field. Consider pronunciation and accent, tone and pitch, speaking tempo, pauses and hesitations, grammatical structures and errors, vocabulary and word choice, and sentence length and complexity, rhetorical devices, and emotional expression. Do NOT include speaker content or topics in the fields and do NOT include descriptions of the transcript content in the speaker descriptions (i.e. what the speaker is talking about or who they are talking to). 

      IMPORTANT: Try to make different speaker descriptions as distinct/unique as possible from each other. For instance, if SPEAKER A has a field:

      ---
      pronunciation_and_accent: 'has a neutral accent and clear pronunciation, making it easy to understand their words.'
      ---

      Then SPEAKER B should NOT have the same content for the 'pronunciation_and_accent' field. Instead, try to make it distinct and uniqe.



    Existing Speaker Descriptions:
    {speaker_descriptions}
    
    Transcript Portion:
    {transcript_chunk}
    
    The response should ONLY be a JSON object with the updated speaker descriptions in the following format:
    {{
      "SPEAKER_A": {{
        "pronunciation_and_accent": "...",
        "tone_and_pitch": "...",
        "speaking_tempo": "...",
        "pauses_and_hesitations": "...",
        "grammatical_structures_and_errors": "...",
        "vocab_and_word_choice": "...",
        "sentence_length_and_complexity": "...",
        "rhetorical_devices": "...",
        "emotional_expression": "..."
      }},
      "SPEAKER_B": {{ // OPTIONAL
        .
        .
        .
      }},
      "SPEAKER_C": {{ // OPTIONAL
        .
        .
        .
      }}
      // MAX 3 speakers with similar fields as needed
    }}

    NOTE: If more than 3 speakers are found, please only include the first 3 in the response.
    IMPORTANT: Substitute "..." with your own descriptions. Do NOT include the ellipses in the response.
    IMPORTANT: ONLY include speakers if their labels are found in the transcript portion.
    IMPORTANT: Please do NOT include any other information in the response other than the JSON object.
    `);

    const thisPrompt = await LABEL_PROMPT.format({
      speaker_descriptions,
      transcript_chunk: chunk,
    });

    console.log('\n\n\nLABEL_PROMPT:', thisPrompt);

    try {
      const response = await callChain(LABEL_PROMPT, 1500, {
        transcript_chunk: chunk,
        speaker_descriptions,
      });

      let labeledChunk = await limitTokens(
        parsePartialJson(response.text),
        1200,
        250,
        3,
      );

      labeledChunk = replaceKeysWithClosestMatch(labeledChunk, [
        'SPEAKER_A',
        'SPEAKER_B',
        'SPEAKER_C',
      ]);

      console.log('Labeled chunk:', labeledChunk);

      const similarityScore = compareJson(prevLabelChunk, labeledChunk);

      console.log('SIMILARITY SCORE:', similarityScore, '\n\n\n');

      similarityScores.push(similarityScore);

      if (checkScores(similarityScores, 0.8, 5)) {
        console.log('speaker descriptions have converged');

        for (const speaker in labeledChunk) {
          if (speaker_summaries_json[speaker]) {
            labeledChunk[speaker].speaker_content =
              speaker_summaries_json[speaker].speaker_content;
          } else {
            console.error('Speaker not found in speaker summaries:', speaker);
          }
        }

        allLabeledChunks = allLabeledChunks.concat(labeledChunk);
        return allLabeledChunks;
      }

      prevLabelChunk = labeledChunk;

      // add speaker content from speaker summaries if not already present
      for (const speaker in labeledChunk) {
        if (!labeledChunk[speaker].speaker_content) {
          console.log('Adding speaker content for speaker:', speaker);
          if (speaker_summaries_json[speaker]) {
            labeledChunk[speaker].speaker_content =
              speaker_summaries_json[speaker].speaker_content;
          } else {
            console.error('Speaker not found in speaker summaries:', speaker);
          }
        }
      }

      if (labeledChunk) {
        labeledChunk = await limitTokens(labeledChunk, 1350, 250, 30);
        labeledChunk = await transformValues(labeledChunk, paraphraseString)
        allLabeledChunks = allLabeledChunks.concat(labeledChunk);

        // replace speaker summaries with updated speaker descriptions
        for (const speaker in labeledChunk) {
          if (speaker_summaries_json[speaker]) {
            speaker_summaries_json[speaker].speaker_content = labeledChunk[
              speaker
            ].speaker_content
              ? labeledChunk[speaker].speaker_content
              : speaker_summaries_json[speaker].speaker_content;
          } else {
            console.error('Speaker not found in speaker summaries:', speaker);
          }
        }

        speaker_descriptions = JSON.stringify(labeledChunk, null, 5);
      }

      chunkCount++;

      // if (chunkCount > 2) {
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

  return allLabeledChunks;
};

async function processDocxFile(inputTextPath: string) {
  try {
    let text = await fs.readFile(inputTextPath, 'utf8');

    // text = removeSpeakerLabels(text)

    //print first 10 lines of text
    // console.log("TEXT:", text.split('\n').slice(0, 10).join('\n'));

    let agentDescription;
    let speaker_summaries = '';

    try {
      const speakerSummariesFilename =
        path.basename(inputTextPath, '.txt') + '__speaker_summaries.json';
      const speakerSummariesDirectoryPath = path.join(
        process.cwd(),
        'scripts/2_speaker_summaries',
      );
      const speakerSummariesFilePath = path.join(
        speakerSummariesDirectoryPath,
        speakerSummariesFilename,
      );

      speaker_summaries = await fs.readFile(speakerSummariesFilePath, 'utf8');
    } catch (err) {
      console.error('Error reading agent description file:', err);
    }

    try {
      const agentDescriptionFilename = 'agent_description_short.json';
      const agentDescriptionDirectoryPath = path.join(process.cwd(), 'scripts');
      const agentDescriptionFilePath = path.join(
        agentDescriptionDirectoryPath,
        agentDescriptionFilename,
      );

      agentDescription = await fs.readFile(agentDescriptionFilePath, 'utf8');
    } catch (err) {
      console.error('Error reading agent description file:', err);
    }

    speaker_summaries = await limitTokens(
      JSON.parse(speaker_summaries),
      1000,
      500,
    );

    speaker_summaries = replaceKeyInObject(
      '_.summary',
      '_.speaker_content',
      speaker_summaries,
    );

    console.log('SPEAKER SUMMARIES:', speaker_summaries);

    await generateSpeakerDescriptions(
      text,
      JSON.stringify(speaker_summaries, null, 4),
    ).then((allLabledChunks) => {
      // get current workding directory with path

      // Extract filename from inputDocxPath, and use it as the output filename plus _qa.json. Save in "qa" directory
      const outputFilename =
        path.basename(inputTextPath, '.txt') + '__speaker_descriptions.json';
      const outputDirectoryPath = path.join(
        process.cwd(),
        'scripts/3_speaker_descriptions',
      );
      const outputFilePath = path.join(outputDirectoryPath, outputFilename);

      console.log('ALL LABELED CHUNKS:', allLabledChunks);

      if (allLabledChunks) {
        fs.writeFile(outputFilePath, JSON.stringify(allLabledChunks, null, 2));
      }
    });
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
        path.basename(inputTextPath, '.txt') + '__speaker_descriptions.json';
      const outputDirectoryPath = path.join(
        process.cwd(),
        'scripts/3_speaker_descriptions',
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

      await processDocxFile(inputTextPath);
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

  // const newObj = replaceKeyInObject('_.summary', '_.speaker_content', speakerSummaries);

  // console.log('newObj', newObj);
  const endTime = Date.now();

  console.log('Total token usage:', getGlobalTokenCount());
  console.log('Total time: ', (endTime - startTime) / 1000, 'seconds');

  console.log('extraction complete');
})();
