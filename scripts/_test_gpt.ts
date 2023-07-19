import { PromptTemplate } from 'langchain/prompts';
import {
  callChain,
  getGlobalTokenCount,
} from './0_utils';


export const test_gpt = async (
  text: string,
) => {

  const TEST_PROMPT =
    PromptTemplate.fromTemplate(`Rephrase the following statement with sarcastic humor:

    ---
    {text}
    ---
  `);

  try {
    let maxTokens = 1500;
    let tokenReduction = 0.1;
    const testPrompt = await TEST_PROMPT.format({
      text
    });
    console.log('TEST PROMPT: \n\n', testPrompt, '\n\n\n');
    while (true) {
      try {
        const response = await callChain(TEST_PROMPT, maxTokens, {
          text
        }, 'gpt-3.5-turbo');
        return response.text;
      } catch (error: any) {
        if (error?.response?.data?.error?.code === 'context_length_exceeded') {
          console.log(
            `CONTENT LENGTH EXCEEDED, REDUCING MAX TOKENS BY ${
              tokenReduction * 100
            }%: `,
            maxTokens,
          );
          maxTokens = Math.floor(maxTokens * (1 - tokenReduction));
          tokenReduction = tokenReduction * 1.5;
        } else {
          throw error;
        }
      }
    }
  } catch (error: any) {
    console.error('Error testing gpt.');
    if (error.response) {
      console.log('ERROR RESPONSE:', error.response.data);
    }
    throw error;
  }
};

export const run = async () => {
  try {
    const testText = "How's it going?"

    const response = await test_gpt(testText);

    console.log("RESPONSE:", response)
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
