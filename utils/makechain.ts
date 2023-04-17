import { OpenAIChat } from 'langchain/llms/openai';
import { LLMChain, ChatVectorDBQAChain, loadQAChain } from 'langchain/chains';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { PromptTemplate } from 'langchain/prompts';
import { CallbackManager } from 'langchain/callbacks';

const CONDENSE_PROMPT =
  PromptTemplate.fromTemplate(`Given the following conversation (i.e. chat history) and a follow up question, rephrase the follow up question to be a standalone question. Keep the standalone question as close as possible to the follow up question. MAKE SURE THE INTENT OF THE FOLLOW UP QUESTION IS PRESERVED. In other words, don't create a standalone question that would result in a response that seems to ignore the follow up question. If the follow up question is already a standalone question, just return the follow up question.

Chat History:
{chat_history}
Follow Up Input: {question}
Standalone question:`);


const QA_PROMPT = PromptTemplate.fromTemplate(
  `You are Tom Campbell, and you are answering questions pertaining to concepts covered in My Big Toe (MBT) discussions. You are given the following MBT video transcripts as context and a question. Provide a conversational answer and use the context if relevant. Answer in a personality and tone that matches that of Tom Campbell, and always in the first person. Do NOT summarize your statements in the end of each message. Avoid repeating yourself. Focus on stating things in a concise way that is easy to understand. ONLY reference the context IF IT IS RELEVANT TO THE QUESTION. I repeat, ONLY reference the context IF IT IS RELEVANT TO THE QUESTION. For example, if the question is "How are you doing today?" and the context mentions a Discord group, do not reference the Discord group in your answer. NEVER mention the fact that you are referencing transcripts. If a request falls outside of the context, improvise as best as possible.

{context}
=========
Question: {question}
=========
Answer in Markdown:`
);


const SOURCE_DOC_EVAL_PROMPT = PromptTemplate.fromTemplate(
  `Given the following user message, gpt response, and source document, please apply the following analysis:

  Evaluate the source document to see if it is relevant to the message and response. Based on this evaluation give it a score between 1 and 10. 1 means the source document is not relevant, 5 means the source document is somewhat relevant, and 10 means the source document is very relevant.

  ALWAYS respond in this JSON format:

  <open_curly_bracket>
    "explanation": <explanation>,
    "score": <score>,
    "source_doc_id": <source_doc_id>
  <close_curly_bracket>


{user_message}
=========
{api_message}
=========
{source_doc_id}
=========
Source Doc: {source_doc}
  `
);

export const evalQuestionChain = () => {
  return new LLMChain({
    llm: new OpenAIChat({ temperature: 0 }, { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' }),
    prompt: SOURCE_DOC_EVAL_PROMPT,
  });
}

export const makeChain = (
  vectorstore: PineconeStore,
  onTokenStream?: (token: string) => void,
) => {
  const questionGenerator = new LLMChain({
    llm: new OpenAIChat({ temperature: 1 }, { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' }),
    prompt: CONDENSE_PROMPT,
  });
  const docChain = loadQAChain(
    new OpenAIChat({
      temperature: 1,
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
    }, { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' }),
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

