/* eslint-disable react/no-unescaped-entities */
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import Layout from '@/components/layout';
import styles from '@/styles/Home.module.css';
import { Message } from '@/types/chat';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import LoadingDots from '@/components/ui/LoadingDots';
import { Document } from 'langchain/document';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { MBTLink, SourceScore } from './api/evaluate_source';
import Pusher from 'pusher-js';
import PubNub from 'pubnub';

export default function Home() {
  const [query, setQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [evaluatingSources, setEvaluatingSources] = useState<boolean>(false);
  const [fetchingSummary, setFetchingSummary] = useState<boolean>(false);
  const [sourceDocs, setSourceDocs] = useState<Document[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<{ [key: number]: any }>({});
  const [lastProcessedId, setLastProcessedId] = useState(0);
  const [doneMessages, setDoneMessages] = useState<boolean>(false);
  const [messageState, setMessageState] = useState<{
    messages: Message[];
    pending?: string;
    history: [string, string][];
    chatSummary: string;
    pendingSourceDocs?: Document[];
  }>({
    messages: [
      {
        message: 'Hi, what MBT related questions do you have?',
        type: 'apiMessage',
        sourcesEvaluated: false,
        sourcesEvaluationPending: false,
      },
    ],
    history: [],
    chatSummary: 'None. This is the beginning of the conversation.',
    pendingSourceDocs: [],
  });

  const { messages, pending, history, chatSummary, pendingSourceDocs } =
    messageState;

  const messageListRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const CURRENT_ENV = process.env.NEXT_PUBLIC_ENV || 'development';

  useEffect(() => {
    textAreaRef.current?.focus();

    console.log('CURRENT ENV:', CURRENT_ENV);

    if (CURRENT_ENV !== 'production') {
      // Enable pusher logging - don't include this in production
      Pusher.logToConsole = true;
      setDoneMessages(true);
    }

    if (CURRENT_ENV === 'production') {
      let pubnub = new PubNub({
        publishKey: 'pub-c-54f26b1f-cd33-4520-b796-b7243505d84e',
        subscribeKey: 'sub-c-61af9b42-e1d7-11e7-9e25-9e24923e4f82',
        userId: 'myUniqueUserId',
      });

      const listener = {
        status: (statusEvent: any) => {
          if (statusEvent.category === 'PNConnectedCategory') {
            console.log('Connected');
          }
        },
        message: (messageEvent: any) => {
          console.log('PUBNUB DATA:', messageEvent);

          const data = JSON.parse(messageEvent.message)

          if (data.id < lastProcessedId) {
            console.log("ADDING LAST PROCESSED ID TO DATA ID")
            data.id = data.id + lastProcessedId;
          }

          setQueue((prevQueue) => ({ ...prevQueue, [data.id]: data }));
        },
        presence: (presenceEvent: any) => {
          // handle presence
        },
      };
      pubnub.addListener(listener);


      // subscribe to a channel
      pubnub.subscribe({
        channels: ["chat-channel"],
      });

      // var pusher = new Pusher('374822fd0361d57a5da2', {
      //   cluster: 'us3',
      // });

      // let channel = pusher.channel('chat-channel');

      // if (!channel) {
      //   console.log('SUBSCRIBING TO CHANNEL');
      //   channel = pusher.subscribe('chat-channel');

      //   channel.bind('chat-event', function (data: any) {
      //     console.log('PUSHER DATA:', data);

      //     setQueue((prevQueue) => ({ ...prevQueue, [data.id]: data }));
      //   });
      // }
    }
  }, []);

  useEffect(() => {
    // Check if the next message in the sequence has arrived
    if (queue[lastProcessedId + 1]) {
      recieveChatData(queue[lastProcessedId + 1]);
      const newQueue = { ...queue };
      delete newQueue[lastProcessedId + 1]; // Remove processed message from queue
      setQueue(newQueue);
      setLastProcessedId((prevId) => prevId + 1); // Increment the processed message ID
    }
  }, [queue, lastProcessedId]);

  const doneMessagesRef = useRef(doneMessages);

  useEffect(() => {
    doneMessagesRef.current = doneMessages;
  }, [doneMessages]);

  // Function that takes in text and creates a hash Id number
  const createHashId = (text: string) => {
    return text.split('').reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);
  };

  const waitForDoneMessages = async () => {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (doneMessagesRef.current) {
          clearInterval(interval);
          resolve(true);
        } else {
          console.log('NOT DONE WAITING YET');
        }
      }, 100);
    });
  };

  const recieveChatData = (data: any) => {
    console.log('RECIEE CHAT DATA:', data);
    if (data.data === '[DONE MESSAGES]') {
      console.log('WE DONE HERE');
      setDoneMessages(true);
    } else {
      setMessageState((state) => ({
        ...state,
        pending: (state.pending ?? '') + data.data,
      }));
    }
  };

  const fetchEval = async (userMessage: Message, apiMessage: Message) => {
    console.log('fetchEval PRE');
    if (
      userMessage.type === 'userMessage' &&
      !apiMessage.sourcesEvaluated &&
      !apiMessage.sourcesEvaluationPending &&
      apiMessage.sourceDocs?.length
    ) {
      console.log('fetchEval');
      const source_docs = apiMessage.sourceDocs || [];

      // console.log('SOURCE DOCS:', source_docs.length);

      setMessageState((state) => ({
        ...state,
        messages: [
          ...state.messages.map((m) => {
            if (
              m.message === userMessage.message ||
              m.message === apiMessage.message
            ) {
              m.sourcesEvaluationPending = true;
            }
            return m;
          }),
        ],
        pending: undefined,
      }));

      try {
        setEvaluatingSources(true);
        const response = await fetch('/api/evaluate_source', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source_docs,
            userMessage: userMessage.message,
            apiMessage: apiMessage.message,
          }),
        });

        console.log('RESPONSE:', response);

        if (!response.ok) {
          throw new Error('Network response was not ok');
        }

        const data = await response.json();
        console.log(data);

        // let { source_scores } = JSON.parse(response.data);
        let { source_scores } = data;
        console.log('SOURCE SCORES AFTER:', source_scores);

        console.log('STATE MESSAGES:', messageState);

        setMessageState((state) => ({
          ...state,
          messages: [
            ...state.messages.map((m) => {
              // console.log("M:", m)
              if (
                m.message === userMessage.message ||
                m.message === apiMessage.message
              ) {
                if (m.sourceDocs && source_scores?.length) {
                  // Filter out source docs that have a relevance score less than 5
                  m.sourceDocs = source_scores
                    .filter((s: SourceScore) => s.score >= 5)
                    .map((s: SourceScore) => {
                      return s.sourceDoc;
                    });
                  m.sourcesEvaluated = true;
                  m.sourcesEvaluationPending = false;
                  // console.log('M EVALUATED:', m);
                }
              }
              return m;
            }),
          ],
          pending: undefined,
        }));
      } catch (error) {
        console.error('There was a problem with the fetch operation:', error);
      } finally {
        setEvaluatingSources(false);
      }
    }
  };

  const fetchSummary = async (historyForSummary: any, currentSummary: any) => {
    try {
      console.log('SUMMARY:', currentSummary);
      setFetchingSummary(true);
      const response = await fetch('/api/generate_summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentSummary,
          history: historyForSummary,
        }),
      });

      console.log('SUMMARY RESPONSE:', response);

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const { newSummary } = await response.json();

      console.log('SUMMARY RESPONSE DATA: ', newSummary);

      setMessageState((state) => ({
        ...state,
        chatSummary: newSummary.text,
      }));
    } catch (error) {
      console.error('There was a problem with the fetch operation:', error);
    } finally {
      setFetchingSummary(false);
    }
  };

  useEffect(() => {
    for (const [index, message] of messageState.messages.entries()) {
      if (
        index < messageState.messages.length - 1 &&
        !message.sourcesEvaluationPending
      ) {
        fetchEval(
          messageState.messages[index],
          messageState.messages[index + 1],
        );
      }
    }

    if (messageState.history.length > 1) {
      // grab all but the most recent history entry
      const historyForSummary = messageState.history.slice(
        0,
        messageState.history.length - 1,
      );

      // now grab the last history entry
      const lastHistoryEntry = messageState.history.slice(
        messageState.history.length - 1,
        messageState.history.length,
      );

      console.log('HISTORY FOR SUMMARY:', historyForSummary);

      // set the message state with the last two history messages
      setMessageState((state) => ({
        ...state,
        history: lastHistoryEntry,
      }));

      console.log('MESSAGE STATE:', messageState);

      fetchSummary(messageState.history, messageState.chatSummary);
    }
  }, [messageState]);

  //handle form submission
  async function handleSubmit(e: any) {
    e.preventDefault();

    setError(null);

    if (!query) {
      alert('Please input a question');
      return;
    }

    const question = query.trim();

    setMessageState((state) => ({
      ...state,
      messages: [
        ...state.messages,
        {
          type: 'userMessage',
          message: question,
          sourcesEvaluated: false,
          sourcesEvaluationPending: false,
        },
      ],
      pending: undefined,
    }));

    setLoading(true);

    setDoneMessages(false); // Reset `doneMessages` state here
    setQuery('');
    setLastProcessedId(0);
    setMessageState((state) => ({ ...state, pending: '' }));

    const ctrl = new AbortController();

    const history = messageState.history;
    const summary = messageState.chatSummary;

    try {
      console.log('STATE HISTORY:', history);

      fetchEventSource('/api/chat', {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          history,
          summary,
        }),
        signal: ctrl.signal,
        onerror(err) {
          console.error('EventSource failed:', err);
          // ctrl.abort();
        },
        onmessage: (event: any) => {
          let data = event.data;

          try {
            data = JSON.parse(data);
          } catch (e) {}

          console.log('EVENT:', event);
          console.log('DATA:', data);
          if (data === '[DONE]') {
            console.log('DONE BUT WAITING');
            waitForDoneMessages().then(() => {
              console.log("data === '[DONE]'");
              console.log('CURRENT QUESTION:', question);
              setMessageState((state) => {
                return {
                  ...state,
                  history: [...state.history, [question, state.pending ?? '']],
                  messages: [
                    ...state.messages,
                    {
                      type: 'apiMessage',
                      message: state.pending ?? '',
                      sourceDocs: state.pendingSourceDocs,
                      sourcesEvaluated: false,
                      sourcesEvaluationPending: false,
                    },
                  ],
                  pending: undefined,
                  pendingSourceDocs: undefined,
                };
              });
              setLoading(false);
              if (CURRENT_ENV === 'production') {
                setDoneMessages(false);
              }
              ctrl.abort();
            });
          } else if (data.sourceDocs) {
            setMessageState((state) => ({
              ...state,
              pendingSourceDocs: data.sourceDocs,
            }));
          } else if (JSON.stringify(data).includes('ERROR')) {
            console.error('Error: ', data);
            setLoading(false);
            ctrl.abort();
            throw new Error(data.replace('[ERROR]', ''));
          } else if (CURRENT_ENV === 'development') {
            console.log('DEV MESSAGE');
            recieveChatData(JSON.parse(event.data));
          }
        },
      });
    } catch (error) {
      setLoading(false);
      setError('An error occurred while fetching the data. Please try again.');
      console.log('error', error);
    }
  }

  //prevent empty submissions
  const handleEnter = useCallback(
    (e: any) => {
      if (e.key === 'Enter' && query) {
        handleSubmit(e);
      } else if (e.key == 'Enter') {
        e.preventDefault();
      }
    },
    [query],
  );

  const chatMessages = useMemo(() => {
    return [
      ...messages,
      ...(pending
        ? [
            {
              type: 'apiMessage',
              message: pending,
              sourceDocs: pendingSourceDocs,
              sourcesEvaluated: false,
              sourcesEvaluationPending: false,
            },
          ]
        : []),
    ];
  }, [messages, pending, pendingSourceDocs]);

  //scroll to bottom of chat
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [chatMessages]);

  return (
    <>
      <Layout>
        <div className="mx-auto flex flex-col gap-4">
          <h1 className="text-2xl font-bold leading-[1.1] tracking-tighter text-center">
            Chat With <span className="text-accent">"AI Guy"</span>
          </h1>
          <main className={styles.main}>
            <div className={styles.cloud}>
              <div ref={messageListRef} className={styles.messagelist}>
                {chatMessages.map((message, index) => {
                  let icon;
                  let className;
                  if (message.type === 'apiMessage') {
                    icon = (
                      <Image
                        src="/bot-image.png"
                        alt="AI"
                        width="40"
                        height="40"
                        className={styles.boticon}
                        priority
                      />
                    );
                    className = styles.apimessage;
                  } else {
                    icon = (
                      <Image
                        src="/usericon.png"
                        alt="Me"
                        width="30"
                        height="30"
                        className={styles.usericon}
                        priority
                      />
                    );
                    // The latest message sent by the user will be animated while waiting for a response
                    className =
                      loading && index === chatMessages.length - 1
                        ? styles.usermessagewaiting
                        : styles.usermessage;
                  }
                  return (
                    <>
                      <div key={`chatMessage-${index}`} className={className}>
                        {icon}
                        <div className={styles.markdownanswer}>
                          <ReactMarkdown linkTarget="_blank">
                            {message.message}
                          </ReactMarkdown>
                        </div>
                      </div>

                      {message.sourcesEvaluationPending && (
                        <div className={styles.loadingwheel}>
                          <LoadingDots color="#000" />
                        </div>
                      )}
                      {message.sourcesEvaluated
                        ? message.sourceDocs && (
                            <div
                              className="p-5"
                              key={`sourceDocsAccordion-${index}`}
                            >
                              <Accordion
                                type="single"
                                collapsible
                                className="flex-col"
                              >
                                {message.sourceDocs.map((doc, index) => (
                                  <div key={`messageSourceDocs-${index}`}>
                                    <AccordionItem value={`item-${index}`}>
                                      <AccordionTrigger>
                                        <h3>Source {index + 1}</h3>
                                      </AccordionTrigger>
                                      <AccordionContent>
                                        <ReactMarkdown linkTarget="_blank">
                                          {`**YouTube link**: [${doc.metadata.ytLink}](${doc.metadata.ytLink})  \n\n  ---  \n\n  ---  \n\n  ---  \n\n` +
                                            doc.metadata.mbtLinks
                                              .map(
                                                (link: MBTLink) =>
                                                  `**Segment Title**: ${link.title}  \n**Segment Description**: ${link.description}  \n**Segment Link**: [${link.link}](${link.link})`,
                                              )
                                              .join(
                                                '  \n\n  ---  \n\n  ---  \n\n  ---  \n\n',
                                              )}
                                        </ReactMarkdown>
                                      </AccordionContent>
                                    </AccordionItem>
                                  </div>
                                ))}
                              </Accordion>
                            </div>
                          )
                        : null}
                    </>
                  );
                })}
                {sourceDocs.length > 0 && (
                  <div className="p-5">
                    <Accordion type="single" collapsible className="flex-col">
                      {sourceDocs.map((doc, index) => (
                        <div key={`SourceDocs-${index}`}>
                          <AccordionItem value={`item-${index}`}>
                            <AccordionTrigger>
                              <h3>Source {index + 1}</h3>
                            </AccordionTrigger>
                            <AccordionContent>
                              <ReactMarkdown linkTarget="_blank">
                                {doc.pageContent}
                              </ReactMarkdown>
                            </AccordionContent>
                          </AccordionItem>
                        </div>
                      ))}
                    </Accordion>
                  </div>
                )}
              </div>
            </div>
            <div className={styles.center}>
              <div className={styles.cloudform}>
                <form onSubmit={handleSubmit}>
                  <textarea
                    disabled={loading || evaluatingSources || fetchingSummary}
                    onKeyDown={handleEnter}
                    ref={textAreaRef}
                    autoFocus={false}
                    rows={1}
                    maxLength={512}
                    id="userInput"
                    name="userInput"
                    placeholder={
                      loading
                        ? 'Waiting for response...'
                        : evaluatingSources
                        ? 'Fetching sources...'
                        : fetchingSummary
                        ? 'Processing the conversation...'
                        : "What's on your mind?"
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className={styles.textarea}
                  />
                  <button
                    type="submit"
                    disabled={loading || evaluatingSources || fetchingSummary}
                    className={styles.generatebutton}
                  >
                    {loading || evaluatingSources || fetchingSummary ? (
                      <div className={styles.loadingwheel}>
                        <LoadingDots color="#000" />
                      </div>
                    ) : (
                      // Send icon SVG in input field
                      <svg
                        viewBox="0 0 20 20"
                        className={styles.svgicon}
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
                      </svg>
                    )}
                  </button>
                </form>
              </div>
            </div>
            {error && (
              <div className="border border-red-400 rounded-md p-4">
                <p className="text-red-500">{error}</p>
              </div>
            )}
          </main>
        </div>
        <footer className="m-auto p-4">
          <a href="https://github.com/JKHeadley">
            Powered by LangChainAI. Demo built by Justin Headley.
          </a>
        </footer>
      </Layout>
    </>
  );
}

// trigger deployment 2
