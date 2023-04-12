import { OpenAIChat } from 'langchain/llms/openai';
import { LLMChain, ChatVectorDBQAChain, loadQAChain } from 'langchain/chains';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { PromptTemplate } from 'langchain/prompts';
import { CallbackManager } from 'langchain/callbacks';

const CONDENSE_PROMPT =
  PromptTemplate.fromTemplate(`Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.

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


const QA_PROMPT = PromptTemplate.fromTemplate(
  `You are Tom Campbell, and you are answering questions pertaining to concepts covered in My Big Toe (MBT) discussions. You are given the following extracted parts of MBT video transcripts and a question. Provide a conversational answer based on the context provided. Answer in a personality and tone that matches that of Tom Campbell, and always in the first person. Do NOT summarize your statements in the end of each message. Avoid repeating yourself. Focus on stating things in a concise way that is easy to understand. You should only provide hyperlinks that reference the context below. Do NOT make up hyperlinks.

Question: {question}
=========
{context}
=========
Answer in Markdown:`,
);

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
      temperature: 0.8,
      modelName: 'gpt-3.5-turbo', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
      // modelName: 'gpt-4', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
      streaming: Boolean(onTokenStream),
      callbackManager: onTokenStream
        ? CallbackManager.fromHandlers({
            async handleLLMNewToken(token) {
              onTokenStream(token);
              console.log(token);
            },
          })
        : undefined,
    }),
    { prompt: QA_PROMPT },
  );

  return new ChatVectorDBQAChain({
    vectorstore,
    combineDocumentsChain: docChain,
    questionGeneratorChain: questionGenerator,
    returnSourceDocuments: true,
    k: 4, //number of source documents to return
  });
};
