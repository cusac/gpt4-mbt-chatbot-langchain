import { OpenAIChat } from 'langchain/llms/openai';
import { LLMChain } from 'langchain/chains';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { PromptTemplate } from 'langchain/prompts';
import { CallbackManager } from 'langchain/callbacks';

const AI_NAME = 'AI Guy';
const NUMBER_OF_REFERENCES = 4;
const ALLOWED_MODELS = ['gpt-3.5-turbo', 'gpt-4'];

// TODO: provide a wrapper to call chains that tracks token usage and handles maxToken errors

export const SUMMARIZE_PROMPT_GPT3 =
  PromptTemplate.fromTemplate(`Given the following conversation summary and follow up Human and AI conversation, update the summary to include the follow up statements. Keep the summary within {word_limit} words and reword/paraphrase as needed. Note that the AI name is ${AI_NAME}.

Summary:
=======
{currentSummary}
=======
Follow Up Conversation:
=======
{conversation}
=======

Updated Summary:`);

const CONDENSE_PROMPT_GPT3 =
  PromptTemplate.fromTemplate(`Given the following conversation summary, most recent exchange, and follow up statement, rephrase the follow up question to be a standalone question that retains the context of the conversation. Keep the standalone question as close as possible to the follow up question. MAKE SURE THE INTENT OF THE FOLLOW UP QUESTION IS PRESERVED. In other words, don't create a standalone question that would result in a response that seems to ignore the follow up question. If the follow up question is already a standalone question, just return the follow up question.

  IMPORTANT: The standalone question should be detailed and explicit such that it contains the important aspects and context of the conversation.

  IMPORTANT: Do not respond with acronyms. For example, convert "MBT" to "My Big Toe" or "FWAU" to "Free Will Awareness Unit".

  Conversation Summary:
  =========
  {summary}
  =========
  Most Recent Exchange:
  =========
  {most_recent_exchange}
  =========
  Follow Up Statement:
  =========
  {follow_up_statement}
  =========
  Standalone question:`);

const CONDENSE_PROMPT_GPT4 =
  PromptTemplate.fromTemplate(`Given the following conversation (i.e. chat history) and a follow up question, rephrase the follow up question to be a standalone question.

  Chat History:
  ========
  {chat_history}
  ========
  Follow Up Question: 
  ========
  {question}
  ========
  Standalone question:`);

const QA_PROMPT_GPT3 = PromptTemplate.fromTemplate(
  `You are AI Guy, an AI that is an expert on Tom Campbell and his My Big Toe (MBT) books. You are answering questions pertaining to concepts covered in MBT discussions. You are given the following MBT transcripts as context and a question. Provide a conversational answer and use the context if relevant. Answer in a personality and tone that matches that of Tom Campbell, and always in the first person. Do NOT summarize your statements in the end of each message. Avoid repeating yourself. Focus on stating things in a concise way that is easy to understand. ONLY reference the context IF IT IS RELEVANT TO THE QUESTION. I repeat, ONLY reference the context IF IT IS RELEVANT TO THE QUESTION. For example, if the question is "How are you doing today?" and the context mentions a Discord group, do not reference the Discord group in your answer. NEVER mention the fact that you are referencing transcripts. If a request falls outside of the context, improvise as best as possible.

  Context:
  =========
  {context}
  =========
  Question:
  =========
  {question}
  ========= 
  Answer in Markdown:`,
);

const QA_PROMPT_WITH_SUMMARY_GPT3 = PromptTemplate.fromTemplate(
  `You are "AI Guy", an AI version of Tom Campbell and an expert on his My Big Toe (MBT) books. You are answering questions pertaining to concepts covered in MBT discussions. Please respond with the same personality, tone, humor, and nuance as Tom (with a mix of your own dynamic humor and enthusiasm when appropriate) and with insights that are accurate to and consistent with the MBT content. You are given the following MBT transcripts as context along with a summary of the conversation, the most recent exchange, and a follow up statement. Provide a conversational response and use the MBT transcripts if relevant. Do NOT summarize your statements in the end of each message. Avoid repeating yourself. ONLY reference the context IF IT IS RELEVANT TO THE QUESTION. I repeat, ONLY reference the context IF IT IS RELEVANT TO THE QUESTION. For example, if the question is "How are you doing today?" and the context mentions a Discord group, do not reference the Discord group in your answer. NEVER mention the fact that you are referencing transcripts. If a request falls outside of the context, improvise as best as possible.

  IMPORTANT: Please try to mix up how you respond. For example, don't always start with "Ah, ...". Pay attention to the previous response and try to respond in a way that is different from the previous response.

  MBT transcripts:
  =========
  {context}
  =========
  Conversation Summary:
  =========
  {summary}
  =========
  Most Recent Exchange:
  =========
  {most_recent_exchange}
  =========
  Follow Up Statement:
  =========
  {follow_up_statement}
  ========= 
  Response in Markdown:`,
);

const QA_PROMPT_WITH_SUMMARY_GPT4 = PromptTemplate.fromTemplate(
  `You are "AI Guy", an AI version of Tom Campbell and an expert on his My Big Toe (MBT) books. You are answering questions pertaining to concepts covered in MBT discussions. Please respond with the same personality, tone, humor, and nuance as Tom (with a mix of your own humor and enthusiasm) and with insights that are accurate to and consistent with the MBT content. You are given the following MBT transcripts as context along with a summary of the conversation, the most recent exchange, and a follow up statement. Provide a conversational answer and use the context ONLY if relevant (i.e. the context fills in gaps or augments your knowledge of MBT).

  MBT transcripts:
  =========
  {context}
  =========
  Conversation Summary:
  {summary}
  =========
  Most Recent Exchange:
  =========
  {most_recent_exchange}
  =========
  Follow Up Statement:
  =========
  {follow_up_statement}
  ========= 
  Response in Markdown:`,
);

const QA_PROMPT_GPT4 = PromptTemplate.fromTemplate(
  `You are Tom Campbell, author of the My Big TOE trilogy. Please respond with the same personality, tone, and nuance as Tom and with insights that are accurate to and consistent with the My Big TOE (MBT) content. You are answering questions pertaining to concepts covered in MBT discussions. You are given the following MBT video transcripts as context and a question. Provide a conversational answer and use the context ONLY if relevant (i.e. the context fills in gaps or augments your knowledge of MBT).

  Context:
  =========
  {context}
  =========
  Question:
  =========
  {question}
  =========
  Answer in Markdown:`,
);

const SOURCE_DOC_EVAL_PROMPT_GPT3 = PromptTemplate.fromTemplate(
  `Given the following user message, gpt response, and source document, please apply the following analysis:

  Evaluate the source document to see if it is relevant to the message and response. Based on this evaluation give it a score between 1 and 10. 1 means the source document is not relevant, 5 means the source document is somewhat relevant, and 10 means the source document is very relevant.

  ALWAYS respond in this JSON format:

  {{
    "explanation": <explanation>,
    "score": <score>,
    "source_doc_id": <source_doc_id>
  }}

  IMPORTANT: ONLY return the JSON response.

User Message:
=========
{user_message}
=========
GPT Response:
=========
{api_message}
=========
Source Doc ID:
=========
{source_doc_id}
=========
Source Doc:
=========
{source_doc}
=========

JSON Response:
  `,
);

const SOURCE_DOC_EVAL_PROMPT_GPT4 = PromptTemplate.fromTemplate(
  `Given the following user message, gpt response, and source document, please apply the following analysis:

  Evaluate the source document to see if it is relevant to the message and response. Based on this evaluation give it a score between 1 and 10. 1 means the source document is not relevant, 5 means the source document is somewhat relevant, and 10 means the source document is very relevant.

  ALWAYS respond in this JSON format:

  {{
    "explanation": <explanation>,
    "score": <score>,
    "source_doc_id": <source_doc_id>
  }}


{user_message}
=========
{api_message}
=========
{source_doc_id}
=========
Source Doc: {source_doc}
  `,
);

export const evalQuestionChain = () => {
  return new LLMChain({
    llm: new OpenAIChat(
      {
        temperature: 0,
        modelName: 'gpt-3.5-turbo', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
        // modelName: 'gpt-4', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
      },
      { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' },
    ),
    prompt: SOURCE_DOC_EVAL_PROMPT_GPT3,
  });
};

const summaryChain = () => {
  return new LLMChain({
    llm: new OpenAIChat(
      {
        temperature: 1,
        modelName: 'gpt-3.5-turbo', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
        // modelName: 'gpt-4', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
      },
      { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' },
    ),
    prompt: SUMMARIZE_PROMPT_GPT3,
  });
};

export const updateSummary = async (currentSummary: any, conversation: any) => {
  const chain = summaryChain();

  const testPrompt = await SUMMARIZE_PROMPT_GPT3.format({
    currentSummary,
    conversation,
    word_limit: 300,
  });

  console.log('TEST SUMMARY PROMPT:', testPrompt);

  try {
    const newSummary = await chain.call({
      currentSummary,
      conversation,
      word_limit: 200,
    });
    return newSummary;
  } catch (e) {
    console.log('Error updating summary:', e);
    throw e;
  }
};

export const formatDocs = (docs: string): string => {
  // Remove lines that match the timestamp formats
  let result = docs.replace(
    /\d{2}:\d{2}:\d{2}.\d{3} --> \d{2}:\d{2}:\d{2}.\d{3}\n|\d{2}:\d{2}.\d{3} --> \d{2}:\d{2}.\d{3}\n/g,
    '',
  );

  // Remove any sequence of two or more line breaks
  result = result.replace(/\n{2,}/g, '\n');

  // Trim leading and trailing whitespaces and line breaks
  result = result.trim();

  return result;
};

export const makeChain = (
  vectorstore: PineconeStore,
  version: string,
  onTokenStream?: (token: string) => void,
) => {
  const questionGenerator = new LLMChain({
    llm: new OpenAIChat(
      {
        temperature: 1,
        modelName: 'gpt-3.5-turbo', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
        // modelName: 'gpt-4', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
      },
      { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' },
    ),
    prompt: CONDENSE_PROMPT_GPT3,
  });

  let model = 'gpt-3.5-turbo';

  if (!ALLOWED_MODELS.includes(version)) {
    console.log('Invalid model version:', version);
  } else {
    model = version;
  }

  console.log("modelName:", model)
  
  const docChain = new LLMChain({
    llm: new OpenAIChat(
      {
        temperature: 1,
        modelName: model,
        // modelName: 'gpt-3.5-turbo', //change this to older versions (e.g. gpt-3.5-turbo) if you don't have access to gpt-4
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
      },
      { organization: 'org-0lR0mqZeR2oqqwVbRyeMhmrC' },
    ),
    prompt: QA_PROMPT_WITH_SUMMARY_GPT4,
  });

  // Function that takes a query and returns a list of documents via a Pinecone query
  const queryDocs = async (question: string, summary: string, chat_history: string, k: number) => {
  

    const dbPrompt = await CONDENSE_PROMPT_GPT3.format({
      summary,
      most_recent_exchange: chat_history,
      follow_up_statement: question,
    });

    // console.log('DB PROMPT', dbPrompt);

    const dbQuery = await questionGenerator.call({
      summary,
      most_recent_exchange: chat_history,
      follow_up_statement: question,
    });

    console.log('dbQuery', dbQuery);

    const docs = await vectorstore.similaritySearch(dbQuery.text, k, {});
    // console.log('QUERY RESULT:', docs);
    return docs;
  };

  const call = async ({
    question,
    chat_history,
    summary,
  }: {
    question: string;
    chat_history: string[][];
    summary: string;
  }) => {
    console.log('summary:', summary);
    console.log('question', question);
    console.log('history', chat_history);

    const chat_history_string = chat_history.reduce((acc, curr) => {
      const human = curr[0];
      const ai = curr[1];
      acc = acc + `Human: ${human}\nAI: ${ai}\n\n`;
      return acc;
    }, '');

    console.log('NEW CHAT HISTORY', chat_history_string);


    // const docs = await queryDocs(newQuestion.text, 4);
    const docs = await queryDocs(question, summary, chat_history_string, NUMBER_OF_REFERENCES);
    const formattedDocs = [...docs].map((doc, index) => {
      const newDoc = { ...doc };
      const content =
        `Transcript #${index + 1}: \n\n` +
        formatDocs(newDoc.pageContent) +
        '\n\n';
      return content;
    });

    // console.log('docs after', formattedDocs);

    const questionPrompt = await QA_PROMPT_WITH_SUMMARY_GPT3.format({
      summary,
      // question: newQuestion.text,
      most_recent_exchange: chat_history_string,
      follow_up_statement: question,
      context: JSON.stringify(formattedDocs, null, 2),
    });

    console.log('questionPrompt', questionPrompt);

    console.log("DOC CHAIN", docChain)

    const response = await docChain.call({
      summary,
      // question: newQuestion.text,
      most_recent_exchange: chat_history_string,
      follow_up_statement: question,
      context: JSON.stringify(formattedDocs, null, 2),
    });

    console.log('answer response', response);

    response.sourceDocuments = docs;

    return response;
  };

  return { call };
};
