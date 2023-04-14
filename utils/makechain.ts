import { OpenAIChat } from 'langchain/llms/openai';
import { LLMChain, ChatVectorDBQAChain, loadQAChain } from 'langchain/chains';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { PromptTemplate } from 'langchain/prompts';
import { CallbackManager } from 'langchain/callbacks';

const CONDENSE_PROMPT =
  PromptTemplate.fromTemplate(`Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question. Weight the question to be more relevant to the conversation.

Chat History:
{chat_history}
Follow Up Input: {question}
Standalone question:`);

// const QA_PROMPT = PromptTemplate.fromTemplate(
//   `You are an AI assistant that is an expert on the works of Tom Campbell including the My Big Toe trilogy. You are given the following extracted parts of MBT video transcripts and a question. Provide a conversational answer based on the context provided. If asked to rephrase or paraphrase please do so and note how you have done so. You should only provide hyperlinks that reference the context below. Do NOT make up hyperlinks.

// If the question is not related to the context, politely respond that you are tuned to only answer questions that are related to the context.

// Question: {question}
// =========
// {context}
// =========
// Answer in Markdown:`,
// );

// I sent a text message to a potential home seller. The message read: "Hi there, I just finished a construction project in you neighborhood, and I am looking for more projects to buy in your neighborhood. I was wondering if you've had any thoughts about selling your home". They replied "yes". What should I reply to them now?

// Now they replied: "maybe this summer, and I would like a buyer that is going to pay top dollar". What should I send to them now?

// const QA_PROMPT = PromptTemplate.fromTemplate(
//   `You are a fiduciary advisor an your job is to find out as much useful information about the person you are interacting with. You are communicating though a mobile texting platform, so make sure to keep responses concise and appropriate length for texting. Based on gathered knowledge, provide suggestions on how to help the person.

// Question: {question}
// =========
// {context}
// =========
// Answer in Markdown:`,
// );


// const QA_PROMPT = PromptTemplate.fromTemplate(
//   `You are Tom Campbell, and you are answering questions pertaining to concepts covered in My Big Toe (MBT) discussions. You are given the following extracted parts of MBT video transcripts and a question. Provide a conversational answer based on the context provided. Answer in a personality and tone that matches that of Tom Campbell, and always in the first person. Use examples of Tom talking in the transcripts to better match his personality and tone. You should only provide hyperlinks that reference the context below. Do NOT make up hyperlinks.

// Question: {question}
// =========
// {context}
// =========
// Answer in Markdown:`,
// );


// const QA_PROMPT = PromptTemplate.fromTemplate(
//   `You are Tom Campbell, and you are answering questions pertaining to concepts covered in My Big Toe (MBT) discussions. You are given the following extracted parts of MBT video transcripts and a question. Provide a conversational answer based on the context provided. Answer in a personality and tone that matches that of Tom Campbell, and always in the first person. Do NOT summarize your statements in the end of each message. Avoid repeating yourself. Focus on stating things in a concise way that is easy to understand. ONLY reference the context from the video transcripts IF IT IS RELEVANT TO THE QUESTION.

// Question: {question}
// =========
// {context}
// =========
// Answer in Markdown:`,
// );


const QA_PROMPT = PromptTemplate.fromTemplate(
  `You are Tom Campbell, and you are answering questions pertaining to concepts covered in My Big Toe (MBT) discussions. You are given the following MBT video transcripts as context and a question. Provide a conversational answer and use the context if relevant. Answer in a personality and tone that matches that of Tom Campbell, and always in the first person. Do NOT summarize your statements in the end of each message. Avoid repeating yourself. Focus on stating things in a concise way that is easy to understand. ONLY reference the context IF IT IS RELEVANT TO THE QUESTION. I repeat, ONLY reference the context IF IT IS RELEVANT TO THE QUESTION. For example, if the question is "How are you doing today?" and the context mentions a Discord group, do not reference the Discord group in your answer.

{context}
=========
Question: {question}
=========
Answer in Markdown:`
);

const COMBINE_MAP_PROMPT = PromptTemplate.fromTemplate(
  `You are Tom Campbell, author of the My Big Toe book trilogy. You are given the following extracted parts of MBT video transcripts. Summarize the conversations. Include ONLY the summaries in your response. Do NOT include the context from the video transcripts.

{context}`,
);

// const SOURCE_DOCS_EVAL_PROMPT = PromptTemplate.fromTemplate(
//   `Given the following question and source documents, please apply the following analysis:
  
//   1) Evaluate the question to see if it is the type of question that would be useful to provide context references. Consider that subjective questions can benefit from references if the reference is subjective as well. Based on this evaluation give it a weight between 0 and 1. 0 means context references are not useful, 1 means source references are very useful.

//   2) Evaluate each source document to see if it is relevant to the question. Based on this evaluation give it a weight between 0 and 1. 0 means the source document is not relevant, 1 means the source document is very relevant. If no source documents are provided, then the weight should be 0.

//   3) Use the weights from 1 and 2 to calculate a relevance score for each source document. The relevance score should be a number between 0 and 1. 0 means the source document should NOT be shown as a reference, 1 means it SHOULD be shown as a reference.

//   4) ALWAYS provide a score. If there is any confusion, please provide a score of 0.

//   FINAL_SCORE:


// {question}
// =========
// Source Docs: {source_docs}
//   `
// );


const SOURCE_DOCS_EVAL_PROMPT = PromptTemplate.fromTemplate(
  `Given the following question and source documents, please apply the following analysis:

  Evaluate each source document to see if it is relevant to the question. Based on this evaluation give it a score between 1 and 10. 1 means the source document is not relevant, 5 means the source document is somewhat relevant, and 10 means the source document is very relevant.

  Make sure EVERY source document has a score and an explanation. If there is any confusion, please provide a score of 1. ONLY give scores to source documents that exist. For example, if there are 8 source documents, do not give scores to source documents 9, 10, 11, etc. If there are no source documents, then the score should be 1.

  ALWAYS respond in this format:

  SOURCE_DOC_1: <score> --- <explanation>
  SOURCE_DOC_2: <score> --- <explanation>
  SOURCE_DOC_3: <score> --- <explanation>
  .
  .
  .
  SOURCE_DOC_N: <score> --- <explanation>


{question}
=========
Source Docs: {source_docs}
  `
);


const SOURCE_DOC_EVAL_PROMPT = PromptTemplate.fromTemplate(
  `Given the following user message, gpt response, and source document, please apply the following analysis:

  Evaluate the source document to see if it is relevant to the message and response. Based on this evaluation give it a score between 1 and 10. 1 means the source document is not relevant, 5 means the source document is somewhat relevant, and 10 means the source document is very relevant.

  ALWAYS respond in this JSON format:

  <open_curly_bracket>
    "explanation": <explanation>,
    "score": <score>,
  <close_curly_bracket>


{user_message}
=========
{api_message}
=========
Source Doc: {source_doc}
  `
);

export const evalQuestionChain = () => {
  return new LLMChain({
    llm: new OpenAIChat({ temperature: 0 }),
    prompt: SOURCE_DOC_EVAL_PROMPT,
  });
}

  

export const makeChain = (
  vectorstore: PineconeStore,
  onTokenStream?: (token: string) => void,
) => {
  const questionGenerator = new LLMChain({
    llm: new OpenAIChat({ temperature: 0 }),
    prompt: CONDENSE_PROMPT,
  });
  const docChain = loadQAChain(
    new OpenAIChat({
      temperature: 0,
      modelName: 'gpt-3.5-turbo', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
      // modelName: 'gpt-4', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
      streaming: Boolean(onTokenStream),
      callbackManager: onTokenStream
        ? CallbackManager.fromHandlers({
            async handleLLMNewToken(token) {
              onTokenStream(token);
              // console.log(token);
            },
          })
        : undefined,
    }),
    { prompt: QA_PROMPT, combineMapPrompt: COMBINE_MAP_PROMPT },
    // { combineMapPrompt: COMBINE_MAP_PROMPT, combinePrompt: QA_PROMPT, type: 'map_reduce'  },
    // { prompt: QA_PROMPT, combineMapPrompt: COMBINE_MAP_PROMPT, type: 'map_reduce'  },
  );

  // const docChain = loadQAMapReduceChain(
  //   new OpenAIChat({
  //     temperature: 0,
  //     modelName: 'gpt-3.5-turbo', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
  //   }),
  //   new OpenAIChat({
  //     temperature: 0,
  //     modelName: 'gpt-3.5-turbo', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
  //     // modelName: 'gpt-4', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
  //     streaming: Boolean(onTokenStream),
  //     callbackManager: onTokenStream
  //       ? CallbackManager.fromHandlers({
  //           async handleLLMNewToken(token) {
  //             onTokenStream(token);
  //             // console.log(token);
  //           },
  //         })
  //       : undefined,
  //   }),
  //   // { prompt: QA_PROMPT, combineMapPrompt: COMBINE_MAP_PROMPT },
  //   { combineMapPrompt: COMBINE_MAP_PROMPT, combinePrompt: QA_PROMPT  },
  //   // { prompt: QA_PROMPT, combineMapPrompt: COMBINE_MAP_PROMPT, type: 'map_reduce'  },
  // );

  return new ChatVectorDBQAChain({
    vectorstore,
    combineDocumentsChain: docChain,
    questionGeneratorChain: questionGenerator,
    returnSourceDocuments: true,
    k: 8, //number of source documents to return
  });
};

