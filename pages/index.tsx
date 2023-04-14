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
import { SourceScore } from './api/evaluate_source';

export default function Home() {
  const [query, setQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [sourceDocs, setSourceDocs] = useState<Document[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [messageState, setMessageState] = useState<{
    messages: Message[];
    pending?: string;
    history: [string, string][];
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
    pendingSourceDocs: [],
  });

  const { messages, pending, history, pendingSourceDocs } = messageState;

  const messageListRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textAreaRef.current?.focus();
  }, []);

  // Function that takes in text and creates a hash Id number
  const createHashId = (text: string) => {
    return text.split('').reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);
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

      console.log('SOURCE DOCS:', source_docs.length);

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
        // console.log('SOURCE SCORES BEFORE: ', source_scores);
        // // source_scores = JSON.parse(source_scores)
        // if (source_scores?.length > 0) {
        //   source_scores = source_scores.map((s: string) => JSON.parse(s));
        //   source_scores = source_scores.map((s: any, i: number) => {
        //     s.id = createHashId(source_docs[i].pageContent);
        //     console.log('ID CREATED: ', s.id);
        //     return s;
        //   });
        // } else {
        //   return;
        // }
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
      }
    }
  };

  // console.log("fetchEval PRE")
  // if (
  //   userMessage.type === 'userMessage' &&
  //   !apiMessage.sourcesEvaluated &&
  //   !apiMessage.sourcesEvaluationPending &&
  //   apiMessage.sourceDocs?.length
  // ) {
  //   console.log("fetchEval")
  //   const source_docs = apiMessage.sourceDocs || [];

  //   console.log("SOURCE DOCS:", source_docs.length)

  //   setMessageState((state) => ({
  //     ...state,
  //     messages: [
  //       ...state.messages.map((m) => {
  //         if (
  //           m.message === userMessage.message ||
  //           m.message === apiMessage.message
  //         ) {
  //           m.sourcesEvaluationPending = true;
  //         }
  //         return m;
  //       }),
  //     ],
  //     pending: undefined,
  //   }));

  // try {
  //   const ctrl = new AbortController();
  //   console.log("FETCH EVAL")
  //   fetchEventSource('/api/evaluate_source', {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({
  //       source_docs,
  //       userMessage: userMessage.message,
  //       apiMessage: apiMessage.message,
  //     }),
  //     signal: ctrl.signal,
  //     onmessage: (event: any) => {
  //       let { source_scores } = JSON.parse(event.data);
  //       console.log('SOURCE SCORES BEFORE: ', source_scores);
  //       // source_scores = JSON.parse(source_scores)
  //       if (source_scores?.length > 0) {
  //         source_scores = source_scores.map((s: string) => JSON.parse(s));
  //         source_scores = source_scores.map((s: any, i: number) => {
  //           s.id = createHashId(source_docs[i].pageContent);
  //           console.log("ID CREATED: ", s.id)
  //           return s;
  //         });
  //       } else {
  //         ctrl.abort();
  //         return;
  //       }
  //       console.log('SOURCE SCORES AFTER:', source_scores);

  //       console.log("STATE MESSAGES:", messageState)

  //       setMessageState((state) => ({
  //         ...state,
  //         messages: [
  //           ...state.messages.map((m) => {
  //             // console.log("M:", m)
  //             if (
  //               m.message === userMessage.message ||
  //               m.message === apiMessage.message
  //             ) {
  //               if (
  //                 m.sourceDocs &&
  //                 source_scores?.length
  //               ) {
  //                 // Filter out source docs that have a relevance score less than 5
  //                 m.sourceDocs = m.sourceDocs.filter((d, i) => {
  //                   let score = source_scores.filter((s: any) => s.id === createHashId(d.pageContent));
  //                   if (score.length > 0) {
  //                     score = score[0].score;
  //                   } else {
  //                     score = 0;
  //                   }
  //                   // console.log('SCORE: ', score, score >= 5);
  //                   // console.log("ExPL:", source_scores[i].explanation)
  //                   return score >= 5;
  //                 });
  //                 m.sourcesEvaluated = true;
  //                 m.sourcesEvaluationPending = false;
  //                 // console.log('M EVALUATED:', m);
  //               }
  //             }
  //             return m;
  //           }),
  //         ],
  //         pending: undefined,
  //       }));

  //       ctrl.abort();
  //     },
  //   }).then(() => {
  //     console.log('Fetch request started');
  //   }).catch((error) => {
  //     if (error.name === 'AbortError') {
  //       console.log('Fetch request aborted');
  //     } else {
  //       console.log('Fetch request error', error);
  //     }
  //   });;
  // } catch (error) {
  //   setError(
  //     'An error occurred while fetching the data. Please try again.',
  //   );
  //   console.log('error', error);
  // }
  //   }
  // };

  // const fetchEval = async (userMessage: Message, apiMessage: Message) => {

  //   console.log("fetchEval PRE")
  //   if (
  //     userMessage.type === 'userMessage' &&
  //     !apiMessage.sourcesEvaluated &&
  //     !apiMessage.sourcesEvaluationPending &&
  //     apiMessage.sourceDocs?.length
  //   ) {
  //     console.log("fetchEval")
  //     const source_docs = apiMessage.sourceDocs || [];

  //     console.log("SOURCE DOCS:", source_docs.length)

  //     setMessageState((state) => ({
  //       ...state,
  //       messages: [
  //         ...state.messages.map((m) => {
  //           if (
  //             m.message === userMessage.message ||
  //             m.message === apiMessage.message
  //           ) {
  //             m.sourcesEvaluationPending = true;
  //           }
  //           return m;
  //         }),
  //       ],
  //       pending: undefined,
  //     }));

  //     try {
  //       const ctrl = new AbortController();
  //       console.log("FETCH EVAL")
  //       fetchEventSource('/api/evaluate_source', {
  //         method: 'POST',
  //         headers: {
  //           'Content-Type': 'application/json',
  //         },
  //         body: JSON.stringify({
  //           source_docs,
  //           userMessage: userMessage.message,
  //           apiMessage: apiMessage.message,
  //         }),
  //         signal: ctrl.signal,
  //         onmessage: (event: any) => {
  //           let { source_scores } = JSON.parse(event.data);
  //           console.log('SOURCE SCORES BEFORE: ', source_scores);
  //           // source_scores = JSON.parse(source_scores)
  //           if (source_scores?.length > 0) {
  //             source_scores = source_scores.map((s: string) => JSON.parse(s));
  //             source_scores = source_scores.map((s: any, i: number) => {
  //               s.id = createHashId(source_docs[i].pageContent);
  //               console.log("ID CREATED: ", s.id)
  //               return s;
  //             });
  //           } else {
  //             ctrl.abort();
  //             return;
  //           }
  //           console.log('SOURCE SCORES AFTER:', source_scores);

  //           console.log("STATE MESSAGES:", messageState)

  //           setMessageState((state) => ({
  //             ...state,
  //             messages: [
  //               ...state.messages.map((m) => {
  //                 // console.log("M:", m)
  //                 if (
  //                   m.message === userMessage.message ||
  //                   m.message === apiMessage.message
  //                 ) {
  //                   if (
  //                     m.sourceDocs &&
  //                     source_scores?.length
  //                   ) {
  //                     // Filter out source docs that have a relevance score less than 5
  //                     m.sourceDocs = m.sourceDocs.filter((d, i) => {
  //                       let score = source_scores.filter((s: any) => s.id === createHashId(d.pageContent));
  //                       if (score.length > 0) {
  //                         score = score[0].score;
  //                       } else {
  //                         score = 0;
  //                       }
  //                       // console.log('SCORE: ', score, score >= 5);
  //                       // console.log("ExPL:", source_scores[i].explanation)
  //                       return score >= 5;
  //                     });
  //                     m.sourcesEvaluated = true;
  //                     m.sourcesEvaluationPending = false;
  //                     // console.log('M EVALUATED:', m);
  //                   }
  //                 }
  //                 return m;
  //               }),
  //             ],
  //             pending: undefined,
  //           }));

  //           ctrl.abort();
  //         },
  //       }).then(() => {
  //         console.log('Fetch request started');
  //       }).catch((error) => {
  //         if (error.name === 'AbortError') {
  //           console.log('Fetch request aborted');
  //         } else {
  //           console.log('Fetch request error', error);
  //         }
  //       });;
  //     } catch (error) {
  //       setError(
  //         'An error occurred while fetching the data. Please try again.',
  //       );
  //       console.log('error', error);
  //     }
  //   }
  // };

  useEffect(() => {
    // console.log('MESSAGE STATE CHANGED:', messageState);
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
    setQuery('');
    setMessageState((state) => ({ ...state, pending: '' }));

    const ctrl = new AbortController();

    try {
      fetchEventSource('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          history,
        }),
        signal: ctrl.signal,
        onmessage: (event: any) => {
          if (event.data === '[DONE]') {
            setMessageState((state) => ({
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
            }));
            setLoading(false);
            ctrl.abort();
          } else {
            const data = JSON.parse(event.data);
            if (data.sourceDocs) {
              // console.log('SOURCE DOCS: ', data.sourceDocs);
              setMessageState((state) => ({
                ...state,
                pendingSourceDocs: data.sourceDocs,
              }));
            } else {
              setMessageState((state) => ({
                ...state,
                pending: (state.pending ?? '') + data.data,
              }));
            }
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
            Chat With MBT <span className="text-accent">AI</span>
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
                                          {doc.pageContent}
                                        </ReactMarkdown>
                                        <p className="mt-2">
                                          <b>Source:</b> {doc.metadata.source}
                                        </p>
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
                    disabled={loading}
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
                        : "What's on your mind?"
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className={styles.textarea}
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className={styles.generatebutton}
                  >
                    {loading ? (
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
          <a href="https://twitter.com/mayowaoshin">
            Powered by LangChainAI. Demo built by Mayo (Twitter: @mayowaoshin).
          </a>
        </footer>
      </Layout>
    </>
  );
}
