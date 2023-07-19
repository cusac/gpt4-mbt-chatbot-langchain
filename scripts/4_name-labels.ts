import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import { PromptTemplate } from 'langchain/prompts';
import {
  callChain,
  getHighestNameCounts,
  getGlobalTokenCount,
  replaceSpeakerLabels,
  getLabeledSegmentsAndLabelsSplit,
  parsePartialJson,
  findMaxKey,
  calculateSpeakerPercentages,
  detectDuplicateSpeakers
} from './0_utils';

const agentNames = 'Tom Campbell';

const compareSpeakers = async (speaker_descriptions: any) => {
  const SIMILARITY_PROMPT =
    PromptTemplate.fromTemplate(`Given the two speaker descriptions, compare each speaker characteristic by providing an analysis of how similar they are, then rate the similarity of the charachteristic between 1 and 10, where 1 is not similar at all and 10 is very similar.

      For instance, given the example speaker descriptions:
      
      ---
      
      Speaker Description Example:
      
      {{
        "SPEAKER_A": {{
          "pronunciation_and_accent": "Has a clear and articulate pronunciation with a neutral accent, making it easy to understand their words.",
          "tone_and_pitch": "Maintains a professional and inquisitive tone throughout the conversation, with occasional fluctuations in pitch to emphasize certain points.",
            .
            .
            .
          "emotional_expression": "Maintains a professional and objective demeanor throughout the conversation, with no noticeable emotional expression."
        }},
        "SPEAKER_B": {{
          "pronunciation_and_accent": "Has a clear and articulate pronunciation with a slight accent, which may be difficult to identify but adds a unique quality to their speech.",
          "tone_and_pitch": "Maintains a confident and knowledgeable tone throughout the conversation, with occasional fluctuations in pitch to emphasize certain points.",
            .
            .
            .
          "emotional_expression": "Maintains a calm and objective demeanor throughout the conversation, with occasional hints of enthusiasm or passion for their subject matter."
        }}
      }}
      
      Example JSON Response:
    
      {{
        "pronunciation_and_accent": {{ "analysis": "Both speakers are described as having clear and articulate pronunciation, making them easy to understand. However, Speaker B has a slight accent, which adds a unique quality to their speech. Speaker A has a neutral accent.", "score": 8 }}, 
        "tone_and_pitch": {{ "analysis": "Both speakers use their tone and pitch effectively to convey their points. Speaker A is described as professional and inquisitive, while Speaker B is confident and knowledgeable. Both fluctuate their pitch to emphasize certain points.", "score": 8 }},
          .
          .
          .
        "emotional_expression": {{ "analysis": "Both speakers maintain a professional demeanor, but Speaker A shows no noticeable emotional expression, whereas Speaker B occasionally displays enthusiasm or passion for their subject matter.", "score": 6 }}
      }}

      ---

      IMPORTANT: ONLY respond with a JSON object. Do NOT include an overall analysis at the end.
    
      Speaker Descriptions:
      {speaker_descriptions}
      
    `);

  const prompt_example = await SIMILARITY_PROMPT.format({
    speaker_descriptions,
  });

  console.log('PROMPT example:', prompt_example);

  try {
    const response = await callChain(SIMILARITY_PROMPT, 1500, {
      speaker_descriptions,
    });

    const similarityRetults = response.text;

    console.log('similarityRetults: ', similarityRetults);

    return similarityRetults;

    // if (chunkCount > 10) break

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
    console.error('Error generating name for label:', error);
    //@ts-ignore
    console.error('Error details: ', error?.response?.data?.error);
    return null;
  }
};

const getSpeakerForAgent = async (
  speaker_descriptions: any,
  agent_description: any,
) => {
  const AGENT_PROMPT =
    PromptTemplate.fromTemplate(`Using the provided speaker descriptions and agent description, respond with the speaker label for the speaker description that most closely matches the agent's description. Explain your reasoning by comparing each aspect of the agent's description to each speaker's description.

      For instance, given the example speaker descriptions and agent description:
      
      ---
      
      Speaker Description Example:
      
      {{
        "SPEAKER_A": {{
            "pronunciation_and_accent": "Clear and slight accent",
            "tone_and_pitch": "Friendly and upbeat",
            .
            .
            .
        }},
        "SPEAKER_B": {{
            "pronunciation_and_accent": "Mumbly and strong accent",
            "tone_and_pitch": "Monotone and low",
            .
            .
            .
        }}
      }}
      
      Agent Description Example:
    
      {{
        "AGENT": {{
            "pronunciation_and_accent": "Precise and slight accent",
            "tone_and_pitch": "Friendly and energetic",
            .
            .
            .
        }}
      }}
      
      ---

      Your response should be:

      ---

      The pronunciation and accent of the agent is most similar to SPEAKER_A because the agent's pronunciation is precise and the agent has a slight accent, which is similar to SPEAKER_A's pronunciation and accent of clear and slight accent. 
      The agent's tone and pitch is friendly and energetic, which is similar to SPEAKER_A's tone and pitch of friendly and upbeat. 
      ... (other comparisons)

      Therefore, the agent is most likely:

      ###

      SPEAKER_A

      ###

      ---

      NOTE: If you are unsure, please respond with:

      ---

      UNDETERMINED

      ---
    
      Speaker Descriptions:
      {speaker_descriptions}
      
      Agent Description:
      {agent_description}
    `);

  const prompt_example = await AGENT_PROMPT.format({
    speaker_descriptions,
    agent_description,
  });

  console.log('PROMPT example:', prompt_example);

  try {
    const response = await callChain(AGENT_PROMPT, 1500, {
      speaker_descriptions,
      agent_description,
    });

    const agentLabel = response.text;

    if (agentLabel === 'UNDETERMINED') {
      throw new Error('Agent label is undetermined');
    }

    console.log('Agent label:', agentLabel);

    return agentLabel;

    // if (chunkCount > 10) break

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
    console.error('Error generating name for label:', error);
    //@ts-ignore
    console.error('Error details: ', error?.response?.data?.error);
    return null;
  }
};

const getNameCounts = async (speaker_descriptions: string, text: string) => {
  const maxChars = 4000; // Adjust this value based on the model's token limit
  const segmentsAndLabels = getLabeledSegmentsAndLabelsSplit(text, maxChars);

  let nameCounts: any = {};

  let chunkCount = 0;
  for (const { segment, label } of segmentsAndLabels) {
    console.log('LABEL:', label);
    console.log('SEGMENT:', segment);

    const LABEL_PROMPT =
      PromptTemplate.fromTemplate(`Using the provided speaker descriptions and transcript portion, please return the speaker name that most closely matches the transcript.

      For instance, given the example speaker descriptions and transcript portion:
      
      ---
      
      Speaker Description Example:
      
      {{
        "SPEAKER_A": {{
            "name": "Tom Campbell",
            "speech_pattern": "Clear and articulate",
            .
            .
            .
        }},
        "SPEAKER_B": {{
            "name": "Sally Smith",
            "speech_pattern": "Fast and mumbly",
            .
            .
            .
        }}
      }}
      
      - Transcript Portion Example:
      
      Hello, my name is Tom Campbell. I'm doing well, thanks for asking. How are you doing Sally?
      
      - Your response should be:
      
      Tom Campbell
      
      ---
    
      NOTE: Try to make a best guess if possible, but if you can't tell, just respond with 'N/A'.
      IMPORTANT: ONLY respond with the name. Do not include a different format such as: Speaker1: Tom Campbell.

      Speaker Descriptions:
      {speaker_descriptions}
      
      Transcript Portion:
      {transcript_chunk}
    `);

    const prompt_example = await LABEL_PROMPT.format({
      transcript_chunk: 'test_transcripts',
      speaker_descriptions,
    });

    console.log('PROMPT example:', prompt_example);

    try {
      const response = await callChain(LABEL_PROMPT, 50, {
        transcript_chunk: segment,
        speaker_descriptions,
      });

      const labelName = response.text;

      console.log('Label name:', labelName);

      nameCounts[label] = nameCounts[label] || {};

      nameCounts[label][labelName] = nameCounts[label][labelName] || 0;
      nameCounts[label][labelName]++;

      console.log('nameCounts:', nameCounts);

      chunkCount++;

      // if (chunkCount > 10) break

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
      console.error('Error generating name for label:', error);
      //@ts-ignore
      console.error('Error details: ', error?.response?.data?.error);
      return null;
    }

    // return allLabeledChunks;
  }

  return nameCounts;
};

async function processDocxFile(inputTextPath: string) {
  try {
    console.log('INPUT TEXT PATH:', inputTextPath);

    let text = await fs.readFile(inputTextPath, 'utf8');


    

    // console.log("ORIGINAL TEXT:", text)

    let speakerDescriptions, speakerDescriptionsJson;

    try {
      const speakerDescriptionsFilename =
        path.basename(inputTextPath, '.txt') + '__speaker_descriptions.json';
      const speakerDescriptionsDirectoryPath = path.join(
        process.cwd(),
        'scripts/3_speaker_descriptions',
      );
      const speakerDescriptionsFilePath = path.join(
        speakerDescriptionsDirectoryPath,
        speakerDescriptionsFilename,
      );

      const speakerDescriptionsData = await fs.readFile(
        speakerDescriptionsFilePath,
        'utf8',
      );
      speakerDescriptionsJson = JSON.parse(speakerDescriptionsData);
      // Grab the last element of the array, which is the most recent speakerDescriptions
      speakerDescriptionsJson =
        speakerDescriptionsJson[speakerDescriptionsJson.length - 1];

      // Delete the "speaker_content" for each speaker
      for (const speaker in speakerDescriptionsJson) {
        delete speakerDescriptionsJson[speaker]['speaker_content'];
      }

      speakerDescriptions = JSON.stringify(speakerDescriptionsJson, null, 4);

      if (!speakerDescriptions) {
        console.error('No speaker descriptions found');
        return;
      }
    } catch (err) {
      console.error('Error reading speaker description file:', err);
      return;
    }

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
      return;
    }

    let agentName;

    for (const key in agentDescription) {
      agentName = key;
    }

    if (!agentName) {
      console.error('No agent name found in agent description file');
      return;
    }

    const outputFilename =
      path.basename(inputTextPath, '.txt') + '__named_transcript.txt';
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/4_named_transcripts',
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

    speakerDescriptions = JSON.parse(speakerDescriptions);

    const speakerScores: any = {}

    for (const speaker in speakerDescriptions) {
      const compareJSON = {
        [speaker]: speakerDescriptions[speaker],
        [agentName]: agentDescription[agentName],
      };
      let compareResults = await compareSpeakers(JSON.stringify(compareJSON, null, 4));
      compareResults = parsePartialJson(compareResults);

      let score = 0;
      for (const key in compareResults) {
        score += compareResults[key].score;
      }
      speakerScores[speaker] = score;
    }

    const speakerPercentages = calculateSpeakerPercentages(text)

    console.log("SPEAKER PERCENTAGES:", speakerPercentages)

    console.log("SPEAKER SCORES BEFORE:", speakerScores)

    for (const speaker in speakerScores) {
      speakerScores[speaker] = speakerScores[speaker] + (speakerPercentages[speaker] / 10)
    }

    console.log("SPEAKER SCORES AFTER:", speakerScores)

    const agentLabel = findMaxKey(speakerScores) 
    
    if (!agentLabel) {
      console.error("No agent label found")
      return
    }

    // const agentLabel = await compareSpeakers(speakerDescriptions);

    // return;

    // const speakerDescriptionsWithAgent = await addAgentToSpeakerDescriptions(speakerDescriptions, agentLabel, agentName);

    // speakerDescriptionsJson[agentName] = speakerDescriptionsJson[agentLabel]
    // delete speakerDescriptionsJson[agentLabel]

    // speakerDescriptions = JSON.stringify(speakerDescriptionsJson, null, 4);

    // console.log("SPEAKER DESCriptions;", speakerDescriptions)

    console.log('AGENT_LABEL:', agentLabel);

    text = text.replaceAll(agentLabel, `-#(${agentName})#-`);

    console.log('NEW TEXT WITH NAME:', text);

    fs.writeFile(outputFilePath, text);

    return;

    // await getNameCounts(speakerDescriptions, text).then((nameCounts) => {
    //   console.log('NAME COUNTS:', nameCounts);

    //   const namesForLabels = getHighestNameCounts(nameCounts);

    //   const namedTranscript = replaceSpeakerLabels(
    //     text,
    //     namesForLabels,
    //     agentName,
    //   );
    //   // get current working directory with path

    //   if (namedTranscript) {
    //     fs.writeFile(outputFilePath, namedTranscript);
    //   }
    // });
  } catch (error) {
    console.error('Error processing .docx file:', error);
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

      await processDocxFile(inputTextPath);
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

  // const input = {
  //   'SPEAKER A': { 'Tom Campbell': 4, 'Mike Winter': 3},
  //   'SPEAKER B': { 'Tom Campbell': 4,  'Mike Winter': 2, 'John': 1 },
  //   'SPEAKER C': { 'Tom Campbell': 5 }
  // };

  // console.log("SPEAKER NAMES:", getHighestNameCounts(input))

  const endTime = Date.now();

  console.log('Total token usage:', getGlobalTokenCount());
  console.log('Total time: ', (endTime - startTime) / 1000, 'seconds');

  console.log('extraction complete');
})();
