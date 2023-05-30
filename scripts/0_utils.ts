import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

import { OpenAI } from 'langchain/llms/openai';
import { LLMChain } from 'langchain/chains';
import { PromptTemplate } from 'langchain/prompts';
import { encode, decode } from 'gpt-3-encoder';
import * as stringSimilarity from 'string-similarity';

let globalTokenCount = 0;

export const getGlobalTokenCount = () => {
  return globalTokenCount;
};

// export function that counts the number of tokens for a string of text
export function countTokens(text: string): number {
  return encode(text).length;
}

export function countAllTokens(...args: any): number {
  return args.reduce((acc: 0, arg: any) => {
    return acc + countTokens(JSON.stringify(arg));
  }, 0);
}

// Function that removes all characters before the first '['
export const removeTextBeforeFirstBracket = (text: string) => {
  const firstBracketIndex = text.indexOf('[');
  if (firstBracketIndex === -1) {
    return text;
  }
  return text.substring(firstBracketIndex);
};

// Use the following JSON format for your response:

// {{
//   "text": "Your condensed conversation chunk",
//   "response": "The provided response"
// }}

// Example JSON response:
// {{
//   "text": "Welcome to the podcast, I'm your host John Smith. Today we have a very special guest, Jane Doe. Jane is a world-renowned expert in the field of artificial intelligence. Jane, welcome to the show.",
//   "resonse": "Thank you for having me."
// }}

export const shortenQuestion = async (
  input: string,
  maxWords = 500,
  initialResponse: string,
) => {
  const SUMMARIZE_PROMPT =
    PromptTemplate.fromTemplate(`Please take the following conversation chunk and condense it to less than ${maxWords} words, maintaining a first-person perspective. The result should retain the key points, context, and the style of the original content as closely as possible. The goal is to generate a condensed version of the conversation that provides a seamless segue into the provided response.

    NOTE: Ensure that the condensed chunk flows naturally into the provided response.

    IMPORTANT: The condensed chunk SHOULD BE IN FIRST PERSON.
    IMPORTANT: ONLY use the provided response for refernce. Do NOT include the content of the provided response as part of the condensed chunk.
    IMPORTANT: If the response references something in the conversation chunk, make sure that the condensed chunk includes that information.

    Example Conversation Chunk:
    "Welcome to the podcast, I'm your host John Smith. Today we have a very special guest, Jane Doe. Jane is a world-renowned expert in the field of artificial intelligence. Jane has a long history of working with AI, and has been a pioneer in the field for over 20 years. Jane, welcome to the show."

    Example Conversation Response:
    "Thank you for having me. It's a pleasure to be here."

    Example Output:
    "Hello, this is your host John Smith on today's podcast. We're joined by the distinguished AI expert, Jane Doe, whose pioneering contributions have spanned over two decades. Welcome, Jane."

    IMPORTANT: Preserve any questions in the condensed chunk and make sure the questions make sense given the provided conversation response.
    IMPORTANT: Do NOT include the content of the provided conversation response as part of the condensed chunk. ONLY use the conversation response for reference.

    FINAL REMINDER: DO NOT INCLUDE THE CONTENT OF THE PROVIDED CONVERSATION RESPONSE AS PART OF THE CONDENSED CHUNK. ONLY USE THE CONVERSATION RESPONSE FOR REFERENCE.


  Conversation Chunk:
  ---
  {text}
  ---

  Conversation Response: (ONLY USE FOR REFRENCE. DO NOT INCLUDE IN THE CONDENSED CHUNK)
  ---
  {initialResponse}
  ---

  Condensed Conversation Chunk:
  `);

  try {
    const testPrompt = await SUMMARIZE_PROMPT.format({
      text: input,
      initialResponse,
    });
    console.log('TEST PROMPT: \n\n', testPrompt, '\n\n\n');
    const response = await callChain(SUMMARIZE_PROMPT, 1500, {
      text: input,
      initialResponse,
    });

    return response.text;
  } catch (error) {
    console.error('Error shortenting text:', error);
    return input;
  }
};

export const summarizeString = async (input: string, maxWords = 500) => {
  const SUMMARIZE_PROMPT =
    PromptTemplate.fromTemplate(`Please summarize the following text to under ${maxWords} words while keeping the content and style as similar as possible to the original. If the text is spoken in first person, keep it so. If the text amounts to a question, maintain the question format.
    
  Text To Summarize:
  {text}
  `);

  try {
    const response = await callChain(SUMMARIZE_PROMPT, 1500, {
      text: input,
    });

    return response.text;
  } catch (error) {
    console.error('Error summarizing text:', error);
    return input;
  }
};

export const paraphraseString = async (input: string) => {
  const PARAPHRASE_PROMPT =
    PromptTemplate.fromTemplate(`Please paraphrase the following text by rewriting it in your own words while keeping the meaning and style as similar as possible to the original.
    
  Text To Paraphrase:
  {text}
  `);

  try {
    const response = await callChain(PARAPHRASE_PROMPT, 1500, {
      text: input,
    });

    return response.text;
  } catch (error) {
    console.error('Error paraphrasing text:', error);
    return input;
  }
};

type FieldWithLongestString = {
  field: string;
  value: string;
};

export function findLongestString(
  obj: any,
  currentField: string = '',
): FieldWithLongestString {
  let longestString: FieldWithLongestString = { field: '', value: '' };

  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      if (obj[key].length > longestString.value.length) {
        longestString.field = currentField ? `${currentField}.${key}` : key;
        longestString.value = obj[key];
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      const childLongestString = findLongestString(
        obj[key],
        currentField ? `${currentField}.${key}` : key,
      );
      if (childLongestString.value.length > longestString.value.length) {
        longestString = childLongestString;
      }
    }
  }

  return longestString;
}

export async function summarizeLongestString(
  obj: any,
  maxWords = 500,
): Promise<any> {
  const longestStringField = findLongestString(obj);
  const fieldPath = longestStringField.field.split('.');
  const modifiedObj = JSON.parse(JSON.stringify(obj)); // Create a deep copy of the original object

  let currentObj = modifiedObj;
  for (let i = 0; i < fieldPath.length; i++) {
    const key = fieldPath[i];

    if (i === fieldPath.length - 1) {
      console.log('Summarizing text:', longestStringField.value);
      currentObj[key] = await summarizeString(
        longestStringField.value,
        maxWords,
      );
      console.log('Summarized text:', currentObj[key]);
    } else {
      currentObj = currentObj[key];
    }
  }

  return modifiedObj;
}

export async function limitTokens(
  obj: any,
  maxTokenCount: number = 1000,
  maxWords: number = 500,
  maxIterations: number = 4,
): Promise<any> {
  let modifiedObj = JSON.parse(JSON.stringify(obj)); // Create a deep copy of the original object
  let currentIteration = 0;

  while (currentIteration < maxIterations) {
    const tokenCount = countTokens(JSON.stringify(modifiedObj));

    if (tokenCount <= maxTokenCount) {
      if (currentIteration > 0) {
        console.log(
          `Reduced token count to ${tokenCount} within ${currentIteration} iterations.`,
        );
      }
      return modifiedObj;
    }

    console.log(
      `Summarizing fields. (Max Token count: ${maxTokenCount}) (Current Token count: ${tokenCount}) (iteration ${currentIteration})\n\n`,
    );

    modifiedObj = await summarizeLongestString(modifiedObj, maxWords);
    currentIteration++;

    // reduce maxWords by 10% each iteration
    maxWords = Math.floor(maxWords * 0.9);
  }

  console.error('Unable to reduce token count within the max iteration limit.');
  return modifiedObj;
}
export type TranscriptData = {
  questioner: string;
  agent: string;
};

// export function extractAgentData(agentLabel: string, transcript: string): TranscriptData[] {
//   // Split the transcript into chunks based on speaker lines
//   let lines = transcript.split("\n");

//   let currentBlock: TranscriptData = { questioner: '', agent: '' };
//   let result: TranscriptData[] = [];
//   let isAgentTurn = false;

//   for(let line of lines) {
//     // Check if the line is a label
//     if (line.trim() === agentLabel) {
//       isAgentTurn = true;
//     } else if (line.startsWith('SPEAKER_')) {
//       if (currentBlock.questioner && currentBlock.agent) {
//         // If a complete block is formed, push it to the result
//         result.push(currentBlock);
//       }
//       // Initialize a new block and set isAgentTurn to false
//       currentBlock = { questioner: '', agent: '' };
//       isAgentTurn = false;
//     } else if (line.trim() !== '') {
//       if (isAgentTurn) {
//         currentBlock.agent += line.trim() + ' ';
//       } else {
//         currentBlock.questioner += line.trim() + ' ';
//       }
//     }
//   }

//   // If there's a block in progress at the end, push it to the result
//   if (currentBlock.questioner && currentBlock.agent) {
//     result.push(currentBlock);
//   }

//   // Trimming trailing spaces
//   for(let block of result) {
//     block.questioner = block.questioner.trim();
//     block.agent = block.agent.trim();
//   }

//   return result;
// }

export function extractQAPairs(
  agentLabel: string,
  transcript: string,
): TranscriptData[] {
  // Split the transcript into chunks based on speaker lines
  let lines = transcript.split('\n');

  let currentBlock: TranscriptData = { questioner: '', agent: '' };
  let result: TranscriptData[] = [];
  let isAgentTurn = false;

  for (let line of lines) {
    // Check if the line is a label
    if (line.trim() === agentLabel) {
      isAgentTurn = true;
    } else if (line.startsWith('SPEAKER_')) {
      isAgentTurn = false;
    } else if (line.trim() !== '') {
      if (isAgentTurn) {
        currentBlock.agent += line.trim() + ' ';
        if (currentBlock.questioner && currentBlock.agent) {
          result.push(currentBlock);
          currentBlock = { questioner: '', agent: '' };
        }
      } else {
        currentBlock.questioner += line.trim() + ' ';
      }
    }
  }

  // If there's a block in progress at the end, push it to the result
  if (currentBlock.questioner && currentBlock.agent) {
    result.push(currentBlock);
  }

  // Trimming trailing spaces
  for (let block of result) {
    block.questioner = block.questioner.trim();
    block.agent = block.agent.trim();
  }

  return result;
}

export const generateSummaryFromQA = async (
  conversationSummary: string,
  qaPairs: TranscriptData[],
  agentName: string,
  maxWords = 2250,
) => {
  const QA_PROMPT =
    PromptTemplate.fromTemplate(`Given the following conversation summary and pairs of questions and answers, please generate an updated summary of the conversation. Limit the summary to ${maxWords} words. When referring to the "agent" use the agent's name: ${agentName}. The summary should be in the third person.
    
  Current Conversation Summary:
  ---
  {conversationSummary}
  ---

  QA Pairs:
  ---
  {qaPairs}
  ---

  Updated Conversation Summary:
  `);

  try {
    const response = await callChain(QA_PROMPT, 2000, {
      conversationSummary,
      qaPairs: JSON.stringify(qaPairs, null, 4),
    });

    return response.text;
  } catch (error) {
    console.error('Error generating summary');
    throw error;
  }
};

export async function processQA(
  qaObject: TranscriptData,
  agentLabel: string,
  conversationSummary: string,
  questionThreshold: number,
  answerThreshold: number,
): Promise<{ qaPairs: TranscriptData[]; conversationSummary: string }> {
  let { questioner, agent } = qaObject;

  let chunks = splitTextIntoChunks(agent, answerThreshold, 100);

  // NOTE: summarizeString takes in a maxWords parameter, not a maxTokens parameter, so we divide the maxTokens by 5 to get a rough estimate of the maxWords
  let summarizedQuestioner =
    questioner.length > questionThreshold
      ? await shortenQuestion(
          questioner,
          Math.floor(questionThreshold / 2),
          chunks[0],
        )
      : questioner;

  // chunks[0].slice(0, 200),

  // console.log("ORIGINAL QUESTIONER:", questioner)
  console.log('SUMMARIZED QUESTIONER:', summarizedQuestioner);

  console.log('ORIGINAL LENGTH:', questioner.length);
  console.log('THRESHOLD:', questionThreshold);
  console.log('NEW LENGTH:', summarizedQuestioner.length);

  if (agent.length <= answerThreshold) {
    return {
      qaPairs: [
        {
          questioner: summarizedQuestioner,
          agent,
        },
      ],
      conversationSummary,
    };
  }

  let results: TranscriptData[] = [];

  for (let i = 0; i < chunks.length; i++) {
    let previousQA = results.length
      ? results[results.length - 1]
      : ({} as TranscriptData);
    let newAnswer = await generateStandaloneAnswer(
      agentLabel,
      conversationSummary,
      [previousQA],
      summarizedQuestioner,
      chunks[i],
    );

    console.log('summarizedQuestioner:', summarizedQuestioner);
    console.log('ORIGINAL ANSWER:', chunks[i]);
    console.log('NEW ANSWER:', newAnswer);

    const nextQAPair = {
      questioner: summarizedQuestioner,
      agent: newAnswer,
    };

    results.push(nextQAPair);

    conversationSummary = await generateSummaryFromQA(
      conversationSummary,
      [nextQAPair],
      agentLabel,
    );

    const limitedSummaryObject = await limitTokens(
      { summary: conversationSummary },
      800,
      800,
      5,
    );

    conversationSummary = limitedSummaryObject.summary;

    if (i < chunks.length - 1) {
      // const potentialAnswer = await generateStandaloneChunk(
      //   conversationSummary,
      //   chunks[i + 1],
      // );
      const potentialAnswer = chunks[i + 1];
      summarizedQuestioner = await generateQuestion(
        conversationSummary,
        [nextQAPair],
        potentialAnswer,
      );
    }
  }

  return { qaPairs: results, conversationSummary };
}

export const generateStandaloneAnswer = async (
  agentLabel: string,
  conversationSummary: string,
  previousQA: TranscriptData[],
  question: string,
  truncatedAnswer: string,
) => {
  const QA_PROMPT =
    PromptTemplate.fromTemplate(`Given the following conversation summary, previous QA pair, conversation chunk, and truncated speaker response, please update the speaker response to replace elipses in the beginning and end with coherent text. The response speaker is named ${agentLabel}, so the response should represent this speaker in the first person.

    IMPORTANT: The final output should be VERY CLOSE to the EXACT wording of the truncated speaker response, except for the beginning and end. The completed speaker response should be LONGER than the truncated speaker response.

    IMPORTANT: Do NOT use elipses (...). It is your job to replace elipses with coherent text. If there are elsipses at the beginning or end of the truncated response, you MUST replace them with coherent text. Do NOT leave elipses in the final output.

    IMPORTANT: The final output should be LONGER than the truncated response. Do NOT shorten the response. Keep the original wording of the truncated response EXCEPT for the beginning and end.

    Example Conversation Summary: 
    ---
    John Smith, the podcast host, introduced Jane Doe, an AI expert, and they've discussed her journey in AI, the transformative power of AI, and how it's influencing our daily lives.
    ---

    Example Previous Q&A:
    ---
    [{{ "questioner": "Welcome to our podcast, Jane. As an expert in AI, could you share with our audience your journey in AI and how it has been transformative in your perspective?", "agent": "Thank you. I'm glad to be here. My journey in AI began when I realized the potential of AI to solve complex problems. Over the years, I've seen AI transform various industries and influence our daily lives in ways we couldn't have imagined a decade ago." }}] 
    ---

    Example Conversation Chunk: 
    ---
    That's fascinating, Jane. Given the rate of AI's advancements, where do you see it heading in the next decade?
    ---

    Example Truncated Speaker Response: 
    ---
    ...certainly, the advancements are indeed rapid. We're starting to see AI's impact in sectors like healthcare, education, and even climate change. The next decade...
    ---

    Example Completed Speaker Response: 
    Well, certainly, the advancements are indeed rapid. We're starting to see AI's impact in sectors like healthcare, education, and even climate change. The next decade is likely to witness even more revolutionary changes as AI continues to evolve and adapt.

    Alternate Example Completed Speaker Response:
    Certainly, the advancements are indeed rapid. We're starting to see AI's impact in sectors like healthcare, education, and even climate change. As for the next decade, I firmly believe we are standing at the precipice of unprecedented technological evolution and AI will be at the forefront of this change.

    NOTE: Notice in the example how the elipses at the beginning and the end of the truncated response were replaced with coherent text. The internal content of the response was NOT modified.
    NOTE: The example completion "Well, certainly, ..." is just an example. Be creative and use your own words. Other examples include: "That's a great question.", "Great point.", "Yes, I agree.", "Yes and no. I think...", "Sure I can elaborate on that." etc.
    NOTE: Do NOT assume the questioner's name unless it is explicitly stated in the conversation summary.
    IMPORTANT: Notice in the example that the output is LONGER than the truncated response. Do NOT shorten the response.
    IMPORTANT: Avoid repeating the same words or phrases from the previous QA response or the conversation summary. For example, if the previous response ends with "It's an exciting future." or "It's an exciting time.", do NOT use a similar phrase in the completed response. Be creative and mix up your responses or simply leave the response open ended.
    I REPEAT: DO NOT USE SIMILAR PHRASES FROM THE PREVIOUS QA RESPONSE OR THE CONVERSATION SUMMARY. For example, if the summary concludes with "..we can gain a deeper understanding of the world around us and continue to push the boundaries of our own exploration", do NOT use a similar phrase in the completed response. Be creative and mix up your responses or simply leave the response open ended by avoiding a conclusive statement.

    FINAL REMINDER: THE FINAL OUTPUT SHOULD BE VERY CLOSE TO THE EXACT WORDING OF THE TRUNCATED SPEAKER RESPONSE, EXCEPT FOR THE BEGINNING AND END. DO NOT SHORTEN OR SUMMARIZE THE COMPLETED SPEAKER RESPONSE.

    THE FINAL OUTPUT SHOULD BE LONGER THAN THE TRUNCATED SPEAKER RESPONSE.
    
  Conversation Summary:
  ---
  {conversationSummary}
  ---

  Previous Q&A:
  ---
  {previousQA}
  ---

  Conversation Chunk:
  ---
  {question}
  ---

  Truncated Speaker Response:
  ---
  {truncatedAnswer}
  ---

  Completed Speaker Response:
  `);

  try {
    let maxTokens = 1500;
    const testPrompt = await QA_PROMPT.format({
      conversationSummary,
      previousQA: JSON.stringify(previousQA, null, 4),
      question,
      truncatedAnswer,
    });
    console.log('TEST PROMPT: \n\n', testPrompt, '\n\n\n');
    while (true) {
      try {
        const response = await callChain(QA_PROMPT, maxTokens, {
          conversationSummary,
          previousQA: JSON.stringify(previousQA, null, 4),
          question,
          truncatedAnswer,
        });
        return response.text;
      } catch (error: any) {
        if (error?.response?.data?.error?.code === 'context_length_exceeded') {
          console.log("CONTENT LENGTH EXCEEDED, REDUCING MAX TOKENS BY 10%: ", maxTokens)
          maxTokens = Math.floor(maxTokens * 0.9);
        } else {
          throw error
        }
      }
    }

  } catch (error: any) {
    console.error('Error generating answer.');
    if (error.response) {
      console.log('ERROR RESPONSE:', error.response.data);
    }
    throw error
  }
};

export const generateStandaloneChunk = async (
  conversationSummary: string,
  partialChunk: string,
) => {
  const CHUNK_PROMPT =
    PromptTemplate.fromTemplate(`Given the following conversation summary please update the partial chunk to be more complete and coherent without changing the meaning or style of the text.

    NOTE: The new chunk should be generally the same length as the original chunk.
    
  Conversation Summary:
  {conversationSummary}

  Partial Chunk:
  {partialChunk}
  `);

  try {
    const response = await callChain(CHUNK_PROMPT, 2000, {
      conversationSummary,
      partialChunk,
    });

    return response.text;
  } catch (error: any) {
    console.error('Error generating chunk.');
    if (error.response) {
      console.log('ERROR RESPONSE:', error.response.data);
    }
    return partialChunk;
  }
};

// TODO: use chatgpt to generate a good example
export const generateQuestion = async (
  conversationSummary: string,
  previousQA: TranscriptData[],
  potentialAnswer: string,
) => {
  const QA_PROMPT =
    PromptTemplate.fromTemplate(`Given the following conversation summary and subsequent question : answer pairs, please generate a question that would elicit the given potential answer. The question should be coherent, descriptive, specific, and relevant to the conversation summary. Try to use second person pronouns (you, your) in the question.

    EXAMPLE:

    Example Conversation Summary:
    ---
    In our Tech & Society podcast, we're discussing with Linda Green, a robotics expert, about the advancements and ethical implications of AI and robotics in society.
    ---

    Example Previous Q&A:
    ---
    [ {{ "questioner": "As a pioneer in robotics, what ethical considerations should we have with the increasing role of AI and robotics?", "agent": "Thanks, Mark. The ethics of AI is crucial. We must consider potential impacts on job displacement, privacy, and decision-making processes. Striking a balance between the benefits and potential downsides of AI and robotics is key." }} ]
    ---

    Exampe Potential Answer:
    ---
    ... indeed, to strike this balance, we need dialogues across all sectors of society. Education is vital to equip people with understanding and skills to navigate this AI era. Simultaneously, regulations should ensure responsible use of these technologies. I've been collaborating with institutions to take these factors into account...
    ---

    Example Generated Question:
    Considering your deep involvement in AI and robotics, and the balance you've discussed earlier, could you elaborate on the ways you've been working with institutions to address these ethical concerns and prepare society for the challenges and opportunities of this new era?

    Alternate Example Generated Question:
    Given your boots-on-the-ground experience in AI and robotics, and the focus on balance you've previously mentioned, could you unpack for us how you've been teaming up with institutions to tackle these ethical dilemmas? How are you helping to gear up society for both the upsides and downsides this AI revolution might bring?

    
  Conversation Summary:
  ---
  {conversationSummary}
  ---

  Previous Q&A:
  ---
  {previousQA}
  ---

  Potential Answer:
  ---
  {potentialAnswer}
  ---

  Generated Question:
  `);

  try {
    const testPrompt = await QA_PROMPT.format({
      conversationSummary,
      previousQA: JSON.stringify(previousQA, null, 4),
      potentialAnswer,
    });
    console.log('TEST PROMPT GENERATED QUESTION: \n\n', testPrompt, '\n\n\n');
    const response = await callChain(QA_PROMPT, 1000, {
      conversationSummary,
      previousQA: JSON.stringify(previousQA, null, 4),
      potentialAnswer,
    });

    return response.text;
  } catch (error: any) {
    console.error('Error generating question');

    if (error.response) {
      console.log('ERROR RESPONSE:', error.response.data);
    }
    throw error;
  }
};

type SpeakerPercentages = { [key: string]: number };

export function calculateSpeakerPercentages(
  transcript: string,
): SpeakerPercentages {
  let totalCharacterCount = 0;
  let speakerCharacterCounts: SpeakerPercentages = {};

  // Get the lines of the transcript
  let lines = transcript.split('\n');

  // Keep track of the current speaker
  let currentSpeaker = '';

  for (let line of lines) {
    // If this line is a speaker, update the current speaker
    if (/^SPEAKER_[A-Z]$/.test(line.trim())) {
      currentSpeaker = line.trim();
      if (!speakerCharacterCounts[currentSpeaker]) {
        speakerCharacterCounts[currentSpeaker] = 0; // Initialize the count for this speaker
      }
    }
    // Otherwise, add the character count to the current speaker's total
    else if (currentSpeaker !== '') {
      let characterCount = line.replace(/\s/g, '').length; // Exclude whitespace
      speakerCharacterCounts[currentSpeaker] += characterCount;
      totalCharacterCount += characterCount;
    }
  }

  // Convert the counts to percentages
  for (let speaker in speakerCharacterCounts) {
    speakerCharacterCounts[speaker] =
      (speakerCharacterCounts[speaker] / totalCharacterCount) * 100;
  }

  return speakerCharacterCounts;
}

export function findMaxKey(obj: JSONObject): string | null {
  let maxKey = null;
  let maxValue = -Infinity;

  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (obj[key] > maxValue) {
        maxValue = obj[key];
        maxKey = key;
      }
    }
  }

  return maxKey;
}

type InputFunction = (key: string) => Promise<any>;
type JSONObject = { [key: string]: any };

export async function transformValues(
  obj: JSONObject,
  fn: InputFunction,
): Promise<JSONObject> {
  let newObj: JSONObject = {};

  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      let value = obj[key];

      // Apply function to string values
      if (typeof value === 'string') {
        newObj[key] = await fn(value);
      }
      // If value is an object, call the function recursively
      else if (typeof value === 'object' && value !== null) {
        newObj[key] = await transformValues(value, fn);
      }
      // Otherwise, just copy the value
      else {
        newObj[key] = value;
      }
    }
  }

  return newObj;
}

// Finds the first complete JSON object in a string and returns it
export const findFirstJson = (input: string) => {
  let jsonString = input.trim();
  let openedBrackets = 0;
  let inString = false;

  let startIndex = -1;
  let endIndex = -1;

  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString[i];
    const prevChar = i > 0 ? jsonString[i - 1] : null;

    if (char === '{' && !inString) {
      if (startIndex === -1) {
        startIndex = i;
      }
      openedBrackets++;
    } else if (char === '}' && !inString) {
      openedBrackets--;
      if (openedBrackets === 0) {
        endIndex = i;
        break;
      }
    } else if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    }
  }

  if (startIndex !== -1 && endIndex !== -1) {
    jsonString = jsonString.substring(startIndex, endIndex + 1);

    try {
      const jsonObject = JSON.parse(jsonString);
      return jsonObject;
    } catch (error) {
      console.error('Error parsing JSON:', error);
      return null;
    }
  } else {
    console.error('No valid JSON object found in input.');
    return null;
  }
};

export const parsePartialJson = (input: string) => {
  let jsonString = input.trim();
  console.log('TEXT:', jsonString);

  const firstJSON = findFirstJson(jsonString);

  if (firstJSON) {
    return firstJSON;
  }

  let openedBrackets = 0;
  let closedBrackets = 0;
  let openedQuotes = 0;
  let closedQuotes = 0;
  let lastClosingBracketIndex = -1;

  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString[i];

    if (char === '{') {
      openedBrackets++;
    } else if (char === '}') {
      closedBrackets++;
      lastClosingBracketIndex = i;
    } else if (char === '"') {
      if (openedQuotes === closedQuotes) {
        openedQuotes++;
      } else {
        closedQuotes++;
      }
    }
  }

  const missingBrackets = openedBrackets - closedBrackets;
  const missingQuotes = openedQuotes - closedQuotes;

  for (let i = 0; i < missingQuotes; i++) {
    jsonString += '"';
  }

  for (let i = 0; i < missingBrackets; i++) {
    jsonString += '}';
  }

  // Remove all characters after the last closing bracket
  jsonString = jsonString.substring(
    0,
    lastClosingBracketIndex + missingBrackets + 1,
  );

  try {
    console.log('JSON:', jsonString);
    const jsonObject = JSON.parse(jsonString);
    return jsonObject;
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return null;
  }
};

export const splitTextIntoChunks = (
  text: string,
  maxChars: number,
  overlap: number,
) => {
  let chunks = [];
  let index = 0;

  while (index < text.length) {
    let endIndex = index + maxChars;

    let chunk = text.slice(index, endIndex);

    if (index !== 0) {
      chunk = '...' + chunk;
    }

    if (endIndex < text.length) {
      chunk = chunk + '...';
      endIndex -= overlap; // Adjust the endIndex to include the overlap
    }

    chunks.push(chunk);
    index = endIndex;
  }

  return chunks;
};

export function getLabeledSegmentsAndLabelsTruncate(
  text: string,
  maxChar?: number,
) {
  const segmentsAndLabels = [];
  const regex = /(SPEAKER_[A-Z])([\s\S]*?)(?=SPEAKER_[A-Z]|$)/g;
  let match;
  while ((match = regex.exec(text))) {
    let truncatedSegment = match[2].trim();
    if (maxChar && truncatedSegment.length > maxChar) {
      truncatedSegment = truncatedSegment.substring(0, maxChar);
    }
    segmentsAndLabels.push({ label: match[1], segment: truncatedSegment });
  }
  return segmentsAndLabels;
}

export function getLabeledSegmentsAndLabelsSplit(
  text: string,
  maxChar?: number,
) {
  const segmentsAndLabels = [];
  const regex = /(SPEAKER_[A-Z])([\s\S]*?)(?=SPEAKER_[A-Z]|$)/g;
  let match;

  while ((match = regex.exec(text))) {
    let segment = match[2].trim();
    if (maxChar) {
      let i = 0;
      while (i < segment.length) {
        let end = i + maxChar > segment.length ? segment.length : i + maxChar;
        let subSegment = segment.substring(i, end);
        segmentsAndLabels.push({ label: match[1], segment: subSegment });
        i += maxChar;
      }
    } else {
      segmentsAndLabels.push({ label: match[1], segment });
    }
  }

  return segmentsAndLabels;
}

export function segmentArrayToText(segmentsAndLabels: any[], maxChar: number) {
  let result = [];
  let currentText = '';

  for (let { label, segment } of segmentsAndLabels) {
    let nextText = `${label}\n\n${segment}\n\n`;

    if (currentText.length + nextText.length > maxChar) {
      // Push current text to result and start a new one
      result.push(currentText.trim());
      currentText = nextText;
    } else {
      // Add next text to current text
      currentText += nextText;
    }
  }

  // Push the last segment if it exists
  if (currentText.trim()) {
    result.push(currentText.trim());
  }

  return result;
}

export function replaceKeyInObject(
  currentPath: string,
  desiredPath: string,
  obj: any,
) {
  const currentKey = currentPath.split('.')[1];
  const desiredKey = desiredPath.split('.')[1];

  let newObj: any = {};

  for (let key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      newObj[key] = replaceKeyInObject(currentPath, desiredPath, obj[key]);
    } else {
      newObj[key] = obj[key];
    }

    if (key === currentKey) {
      newObj[desiredKey] = newObj[currentKey];
      delete newObj[currentKey];
    }
  }

  return newObj;
}

type ObjectKeyType = {
  [key: string]: {
    name: string;
  };
};

function levenshteinDistance(a: string, b: string) {
  const matrix = [];

  let i;
  for (i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  let j;
  for (j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1,
          ),
        ); // deletion
      }
    }
  }

  return matrix[b.length][a.length];
}

export function replaceKeysWithClosestMatch(
  obj: ObjectKeyType,
  desiredKeys: string[],
): ObjectKeyType {
  let newObj: ObjectKeyType = {};

  for (const key in obj) {
    let closestKey = desiredKeys.reduce((a, b) =>
      levenshteinDistance(key, a) < levenshteinDistance(key, b) ? a : b,
    );
    newObj[closestKey] = obj[key];
  }

  return newObj;
}

type JsonObjectType = {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | JsonObjectType
    | Array<JsonObjectType>;
};

export function compareJson(
  json1: JsonObjectType,
  json2: JsonObjectType,
): number {
  const str1 = JSON.stringify(json1);
  const str2 = JSON.stringify(json2);
  const similarity = stringSimilarity.compareTwoStrings(str1, str2);
  return similarity;
}

export function checkScores(
  scores: number[],
  threshold: number,
  n: number,
): boolean {
  // Check if there are enough scores to check
  if (scores.length < n) {
    return false;
  }

  // Get the last N scores
  let lastScores = scores.slice(-n);

  // Check each score against the threshold
  for (let score of lastScores) {
    if (score < threshold) {
      return false;
    }
  }

  // If we've made it this far, all scores are above the threshold
  return true;
}

// export function segmentArrayToText(segmentsAndLabels: any[], maxChar: number) {
//   let result = [];
//   let currentText = '';
//   let lastLabel = '';

//   for (let {label, segment} of segmentsAndLabels) {
//     let nextText = lastLabel === label ? `${segment}\n\n` : `${label}\n\n${segment}\n\n`;

//     if (currentText.length + nextText.length > maxChar) {
//       // Push current text to result and start a new one
//       result.push(currentText.trim());
//       currentText = nextText;
//     } else {
//       // Add next text to current text
//       currentText += nextText;
//     }

//     lastLabel = label;
//   }

//   // Push the last segment if it exists
//   if (currentText.trim()) {
//     result.push(currentText.trim());
//   }

//   return result;
// }

// export function getHighestNameCounts(inputJson: any) {
//   const outputJson: any = {};

//   for (const speaker in inputJson) {
//     const speakerCounts = inputJson[speaker];
//     let maxCount = 0;
//     let maxName = '';

//     for (const name in speakerCounts) {
//       if (speakerCounts[name] > maxCount) {
//         maxCount = speakerCounts[name];
//         maxName = name;
//       }
//     }

//     outputJson[speaker] = maxName;
//   }

//   return outputJson;
// }

// export function getHighestNameCounts(nameCounts: any) {
//   const highestCounts: any = {};

//   for (const speaker in nameCounts) {
//     const counts = nameCounts[speaker];
//     let maxCount = 0;
//     let maxName = null;

//     for (const name in counts) {
//       if (counts[name] > maxCount && (name !== "N/A" || Object.keys(counts).length === 1)) {
//         maxCount = counts[name];
//         maxName = name;
//       }
//     }

//     highestCounts[speaker] = maxName;
//   }

//   return highestCounts;
// }

export function getHighestNameCounts(nameCounts: any) {
  const speakerNames: any = {};
  const allCounts = [];

  for (const speaker in nameCounts) {
    for (const name in nameCounts[speaker]) {
      if (name !== 'N/A') {
        allCounts.push({ speaker, name, count: nameCounts[speaker][name] });
      }
    }
  }

  allCounts.sort((a, b) => b.count - a.count);

  const usedNames = new Set();
  for (const countObj of allCounts) {
    const { speaker, name } = countObj;
    if (!usedNames.has(name) && !speakerNames[speaker]) {
      speakerNames[speaker] = name;
      usedNames.add(name);
    }
  }

  // Assign 'N/A' as a fallback for speakers without a valid name.
  for (const speaker in nameCounts) {
    if (!speakerNames[speaker]) {
      speakerNames[speaker] = 'N/A';
    }
  }

  return speakerNames;
}

// export function replaceSpeakerLabels(transcript: string, speakerNameMap: any, agentName: string) {
//   const regex = /SPEAKER_[A-Z]/g;
//   const replacedTranscript = transcript.replace(regex, (match) => {
//     const name = speakerNameMap[match];
//     return name ? `(${name}):` : match;
//   });

//   return replacedTranscript;
// }

export function replaceSpeakerLabels(
  transcript: string,
  speakerNameMap: any,
  agentName: string,
) {
  const replacedTranscript = transcript.replace(/SPEAKER_[A-Z]/g, (match) => {
    const name = speakerNameMap[match];
    if (name === agentName) {
      return `(${name}):`;
    }
    return match;
  });

  return replacedTranscript;
}

export function removeSpeakerLabels(transcript: string) {
  const regex = /SPEAKER_[A-Z]\n\n/g;
  return transcript.replace(regex, '\n\n###\n\n');
}

export function splitTranscript(transcript: string, agent: string) {
  const regex = new RegExp(
    `(SPEAKER_[A-Z])([^]*?)(?=SPEAKER_[A-Z]|${agent}|$)`,
    'g',
  );
  const agentRegex = new RegExp(
    `(${agent})([^]*?)(?=SPEAKER_[A-Z]|${agent}|$)`,
    'g',
  );

  let transcriptSegments = [];
  let currentQuestioners = '';
  let match;

  while ((match = regex.exec(transcript))) {
    currentQuestioners += '\n' + match[2].trim();
    let agentMatch = agentRegex.exec(transcript);

    if (agentMatch && agentMatch.index < match.index) {
      transcriptSegments.push({
        questioner: currentQuestioners,
        agent: agentMatch[2].trim(),
      });
      currentQuestioners = '';
      agentRegex.lastIndex = match.index;
    }
  }

  while ((match = agentRegex.exec(transcript))) {
    transcriptSegments.push({
      questioner: currentQuestioners,
      agent: match[2].trim(),
    });
    currentQuestioners = '';
  }

  return transcriptSegments;
}

export const callChain = async (
  prompt: PromptTemplate,
  maxTokens: number,
  params: any,
) => {
  const fullPrompt = await prompt.format(params);
  const inputTokens = countAllTokens(fullPrompt);
  console.log('INPUT TOKENS:', inputTokens);

  const chain = new LLMChain({
    llm: new OpenAI(
      { temperature: 0, maxTokens, modelName: 'gpt-3.5-turbo' },
      { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' },
    ),
    prompt,
  });

  const response = await chain.call(params);

  const outputTokens = countAllTokens(response.text);

  console.log('OUTPUT TOKENS:', outputTokens);

  console.log('TOTAL TOKENS:', inputTokens + outputTokens);

  globalTokenCount += inputTokens + outputTokens;

  return response;
};
