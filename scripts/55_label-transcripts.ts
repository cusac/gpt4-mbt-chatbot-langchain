import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';


const generateLabeledTranscript = async (labels: any, transcript: string) => {
  // Delete the first line of the transcript
  const firstNewlineIndex = transcript.indexOf('\n');
  transcript = transcript.slice(firstNewlineIndex + 1);

  // Remove all newlines from the transcript
  transcript = transcript.replace(/\n/g, ' ');
  // console.log('TRANSCRIPT:\n\n', transcript);

  // Combine all array items into a single string
  const combinedLabels = labels.join('\n');

  // Split the combined string by newline to get the full list of labels
  let allLabels = combinedLabels.split('\n');

  // Concatenate lines without labels to the previous line
  allLabels = allLabels.reduce((acc: string[], current: string) => {
    if (current.includes('::')) {
      acc.push(current);
    } else {
      acc[acc.length - 1] += ' ' + current;
    }
    return acc;
  }, []);

  console.log('ALL LABELS:', allLabels);

  for (const label of allLabels) {
    const colonIndex = label.indexOf('::');
    const speakerName = label.slice(0, colonIndex + 2);
    const content = label.slice(colonIndex + 2).trim();

    const contentIndex = transcript.indexOf(content);

    console.log('CONTENT:', content);
    console.log('CONTENT INDEX:', contentIndex);
    if (contentIndex !== -1) {
      transcript =
        transcript.slice(0, contentIndex) +
        '\n\n' +
        speakerName +
        ' ' +
        content +
        transcript.slice(contentIndex + content.length);
    }
  }

  // console.log('TRANSCRIPT: \n\n', transcript);

  // console.log('COMBINED: \n\n', combineOverlappingLabels(transcript));
  // console.log(
  //   'FIXED: \n\n',
  //   fixIncorrectLabels(combineOverlappingLabels(transcript)),
  // );

  return fixIncorrectLabels(combineOverlappingLabels(transcript))

  // return transcript;
};

const combineOverlappingLabels = (transcript: string) => {
  const lines = transcript.split('\n\n');
  let combinedTranscript = lines[0];

  for (let i = 1; i < lines.length; i++) {
    const prevLine = lines[i - 1];
    const currentLine = lines[i];

    const prevSpeakerIndex = prevLine.indexOf('::');
    const currentSpeakerIndex = currentLine.indexOf('::');

    const prevSpeaker = prevLine.slice(0, prevSpeakerIndex + 2);
    const currentSpeaker = currentLine.slice(0, currentSpeakerIndex + 2);

    const prevContent = prevLine.slice(prevSpeakerIndex + 2).trim();
    const currentContent = currentLine.slice(currentSpeakerIndex + 2).trim();

    if (prevSpeaker === currentSpeaker) {
      combinedTranscript += ' ' + currentContent;
    } else {
      combinedTranscript += '\n\n' + currentSpeaker + ' ' + currentContent;
    }
  }

  return combinedTranscript;
};

const fixIncorrectLabels = (transcript: string) => {
  const lines = transcript.split('\n').filter(line => line.trim() !== '');
  let intermediateLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    if (nextLine) {
      const currentSpeaker = line.match(/^(.+?)::/)?.[1] || '';
      const nextSpeaker = nextLine.match(/^(.+?)::/)?.[1] || '';

      const currentContent = line.slice(currentSpeaker.length + 2).trim();
      const nextContent = nextLine.slice(nextSpeaker.length + 2).trim();

      if (
        !currentContent.endsWith('.') &&
        !currentContent.endsWith('?') &&
        !currentContent.endsWith('!') &&
        currentSpeaker &&
        nextSpeaker
      ) {
        intermediateLines.push(`${currentSpeaker}:: ${currentContent}${nextContent}`);
        i++; // Skip next line since it's merged with the current line
      } else {
        intermediateLines.push(line);
      }
    } else {
      intermediateLines.push(line); // Add the last line as it is
    }
  }

  let correctedLines = [];

  for (let i = 0; i < intermediateLines.length; i++) {
    const line = intermediateLines[i];
    const nextLine = intermediateLines[i + 1];

    if (nextLine) {
      const currentSpeaker = line.match(/^(.+?)::/)?.[1] || '';
      const nextSpeaker = nextLine.match(/^(.+?)::/)?.[1] || '';

      const currentContent = line.slice(currentSpeaker.length + 2).trim();
      const nextContent = nextLine.slice(nextSpeaker.length + 2).trim();

      if (currentSpeaker === nextSpeaker) {
        correctedLines.push(`${currentSpeaker}:: ${currentContent} ${nextContent}`);
        i++; // Skip next line since it's merged with the current line
      } else {
        correctedLines.push(line);
        // correctedLines.push(''); // Add an extra newline between different speakers
      }
    } else {
      correctedLines.push(line); // Add the last line as it is
    }
  }

  return correctedLines.join('\n\n');
};



// const fixIncorrectLabels = (transcript: string) => {
//   const lines = transcript.split('\n').filter(line => line.trim() !== '');
//   let correctedLines = [];

//   for (let i = 0; i < lines.length; i++) {
//     const line = lines[i];
//     const nextLine = lines[i + 1];

//     if (nextLine) {
//       const currentSpeaker = line.match(/^(.+?)::/)?.[1] || '';
//       const nextSpeaker = nextLine.match(/^(.+?)::/)?.[1] || '';

//       const currentContent = line.slice(currentSpeaker.length + 2).trim();
//       const nextContent = nextLine.slice(nextSpeaker.length + 2).trim();

//       if (currentSpeaker === nextSpeaker) {
//         correctedLines.push(`${currentSpeaker}:: ${currentContent} ${nextContent}`);
//         i++; // Skip next line since it's merged with the current line
//       } else if (
//         !currentContent.endsWith('.') &&
//         !currentContent.endsWith('?') &&
//         !currentContent.endsWith('!') &&
//         currentSpeaker &&
//         nextSpeaker
//       ) {
//         correctedLines.push(`${currentSpeaker}:: ${currentContent} ${nextContent}`);
//         i++; // Skip next line since it's merged with the current line
//       } else {
//         correctedLines.push(line);
//       }
//     } else {
//       correctedLines.push(line); // Add the last line as it is
//     }
//   }

//   return correctedLines.join('\n');
// };







async function processDocxFile(inputDocxPath: string) {
  try {
    let { value: text } = await mammoth.convertToHtml({
      path: inputDocxPath,
    });

    // First replace all instances of </p><p> with a newline
    // Then replace all instances of <p> and </p> with nothing
    // Then replace all instances of <br> with a newline

    text = text.replace(/<\/p><p>/g, '\n');
    text = text.replace(/<p>/g, '');

    //print first 10 lines of text
    // console.log("TEXT:", text.split('\n').slice(0, 10).join('\n'));

    // Extract filename from inputDocxPath, and use it as the output filename plus _qa.json. Save in "qa" directory
    const labelFilename =
      path.basename(inputDocxPath, '.docx') + '__labeled_chunks.json';
    const labelDirectoryPath = path.join(
      process.cwd(),
      'scripts/4_labeled_chunks',
    );
    const labelFilePath = path.join(labelDirectoryPath, labelFilename);

    const labelData = await fs.readFile(labelFilePath, 'utf8');
    const labeledChunks = JSON.parse(labelData);

    console.log('LABELS:', labeledChunks);

    const outputFilename =
      path.basename(inputDocxPath, '.docx') + '__labeled_transcript.json';
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/5_labeled_transcripts',
    );
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);

    await generateLabeledTranscript(labeledChunks, text).then(
      (labeledTranscript) => {
        // get current workding directory with path

        console.log("LABELED TRANSCRIPT: '\n\n", labeledTranscript, '\n\n')

        if (labeledTranscript) {
          fs.writeFile(
            outputFilePath,
            JSON.stringify(labeledTranscript, null, 2),
          );
        }
      },
    );
  } catch (error) {
    console.error('Error processing .docx file:', error);
  }
}

async function processAllDocxFiles(inputDirectoryPath: string): Promise<void> {
  try {
    const files = await fs.readdir(inputDirectoryPath);
    const docxFiles = files.filter(
      (file: string) => path.extname(file) === '.docx',
    );

    // Skip the first 3 files
    let docsCount = 0;

    for (const docxFile of docxFiles) {
      if (docsCount < 4) {
        docsCount++;
        continue;
      }
      const inputDocxPath = path.join(inputDirectoryPath, docxFile);

      await processDocxFile(inputDocxPath);
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
      'docs/Without Timestamps',
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

  const endTime = Date.now();

  console.log('Total time: ', (endTime - startTime) / 1000, 'seconds');

  console.log('extraction complete');
})();
