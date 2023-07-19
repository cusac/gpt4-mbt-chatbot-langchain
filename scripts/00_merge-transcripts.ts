import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';
import stringSimilarity from 'string-similarity';

// const mergeTranscripts = async (
//   labeledTranscript: string,
//   accurateTranscript: string,
//   wordLimit = 10,
// ) => {
//   const labelRegex = /(?:\r\n|\r|\n|^)SPEAKER\s*([A-Za-z]+)(?:\r\n|\r|\n){2}/g;
//   const labeledSegments = [];

//   // Extract speaker labels and text segments from labeled transcript
//   let match;
//   while ((match = labelRegex.exec(labeledTranscript)) !== null) {
//     const speaker = match[1];
//     const textStart = match.index + match[0].length;
//     const textEnd = labeledTranscript.indexOf('SPEAKER', textStart) - 1;
//     const text = labeledTranscript.slice(textStart, textEnd).trim();
//     const searchText = text.split(' ').slice(0, wordLimit).join(' ');

//     labeledSegments.push({ speaker, text, searchText });
//   }

//   // Apply speaker labels to accurate transcript
//   let result = accurateTranscript;
//   // Replace all newlines with spaces
//   // result = result.replace(/\n/g, ' ');
//   labeledSegments.forEach(({ speaker, searchText }) => {
//     const lines = result.split(/(?:\r\n|\r|\n)/);
//     // console.log("LINES:", lines, '\n\n\n\n')
//     console.log("searchText:", searchText, "\n\n\n\n")

//     const bestMatch = stringSimilarity.findBestMatch(searchText, lines);
//     console.log("RATINGS:", bestMatch.ratings.slice(0, 10), "\n\n")
//     console.log("BEST MATCH:", bestMatch.bestMatch, "\n\n\n\n")
//     if (bestMatch.bestMatch.rating > 0.4) { // You can adjust the threshold for matching accuracy
//       const matchIndex = lines.indexOf(bestMatch.bestMatch.target);
//       lines.splice(matchIndex, 0, `SPEAKER ${speaker}\n`);
//       result = lines.join('\n');
//     }
//   });

//   return result;
// };

function splitIntoOverlappingChunks(
  text: string,
  chunkSize: number,
  overlapSize: number,
) {
  // remove all newlines from text
  text = text.replace(/\n/g, ' ');
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + chunkSize));
    index += chunkSize - overlapSize;
  }
  return chunks;
}

function getLabeledSegmentsAndLabels(text: string, maxChar?: number) {
  const segmentsAndLabels = [];
  const regex = /(SPEAKER [A-Z])([\s\S]*?)(?=SPEAKER [A-Z]|$)/g;
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

function findBestMatchIndex(segment: string, filter: string) {
  // console.log('SEGMETN:', segment, segment.length, '\n\n\n\n');
  // console.log('FILTER:', filter, filter.length, '\n\n\n\n');
  const similarityScores = [];
  let index = 0;
  let count = 0;
  while (index + filter.length/2 <= segment.length) {
    // console.log('INDEX:', index, '\n\n');
    const endIndex = segment.indexOf(' ', index + filter.length);
    // console.log('END INDEX:', endIndex, '\n\n');
    const subSegment = segment.slice(index, endIndex);
    // console.log('SUB SEGMENT:', subSegment, '\n\n');
    const score = stringSimilarity.compareTwoStrings(filter, subSegment);
    // console.log('SCORE:', score, '\n\n\n\n');
    similarityScores.push({ score, subSegment });

    const firstWordLength = subSegment.indexOf(' ');
    index += firstWordLength !== -1 ? firstWordLength + 1 : subSegment.length;
    count++;
    // if (count > 10) break;
  }
  // console.log('SIMILARITY SCORES:', similarityScores, '\n\n\n\n');
  const maxSimilarityScore = Math.max(
    ...similarityScores.map(({ score }) => score),
  );
  const maxSimilarityScoreIndex = similarityScores
    .map(({ score }) => score)
    .indexOf(maxSimilarityScore);
  // console.log('MAX SIMILARITY SCORE:', maxSimilarityScore, '\n\n\n\n');
  // console.log('maxSimilarityScoreIndex:', maxSimilarityScoreIndex, '\n\n\n\n');
  const maxSimilaritySubSegment =
    similarityScores[maxSimilarityScoreIndex].subSegment;
  return segment.indexOf(maxSimilaritySubSegment);
}

async function applySpeakerLabels(
  labeledTranscript: string,
  accurateTranscript: string,
  chunkSize = 100,
  overlapSize = 25,
  filterSize = 50,
) {
  const accurateChunks = splitIntoOverlappingChunks(
    accurateTranscript,
    chunkSize,
    overlapSize,
  );
  const labeledSegmentsAndLabels =
    getLabeledSegmentsAndLabels(labeledTranscript);

  // console.log('accurateChunks:', accurateChunks.slice(0, 10), '\n\n\n\n');
  // console.log(
  //   'labeledSegmentsAndLabels:',
  //   labeledSegmentsAndLabels.slice(0, 10),
  //   '\n\n\n\n',
  // );

  // return

  let count = 0;

  for (const { label, segment } of labeledSegmentsAndLabels) {
    const filter = segment.slice(0, filterSize);
    const bestChunkIndex = stringSimilarity.findBestMatch(
      filter,
      accurateChunks,
    ).bestMatchIndex;
    const bestMatchIndex = findBestMatchIndex(
      accurateChunks[bestChunkIndex],
      filter,
    );

    accurateChunks[bestChunkIndex] = [
      accurateChunks[bestChunkIndex].slice(0, bestMatchIndex),
      '\n\n',
      label,
      '\n',
      accurateChunks[bestChunkIndex].slice(bestMatchIndex),
    ].join('');

    // console.log(
    //   'accurateChunk labeled:',
    //   accurateChunks[bestChunkIndex],
    //   '\n\n\n\n',
    // );

    count++;
    // if (count > 3) break;
  }

  let mergedTranscript = '';
  for (let i = 0; i < accurateChunks.length - 1; i++) {
    mergedTranscript += accurateChunks[i].slice(0, -overlapSize);
  }
  mergedTranscript += accurateChunks[accurateChunks.length - 1];

  return mergedTranscript;
}

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
    const labelFilename = `assembly_ai_alfa_vedic.txt`;
    const labelDirectoryPath = path.join(process.cwd(), 'scripts');
    const labelFilePath = path.join(labelDirectoryPath, labelFilename);

    const labelData = await fs.readFile(labelFilePath, 'utf8');

    // console.log('LABELS:', labelData);

    const outputFilename =
      path.basename(inputDocxPath, '.docx') + '__merged_transcript.json';
    const outputDirectoryPath = path.join(
      process.cwd(),
      'scripts/5_labeled_transcripts',
    );
    const outputFilePath = path.join(outputDirectoryPath, outputFilename);

    await applySpeakerLabels(labelData, text).then((labeledTranscript) => {
      // get current workding directory with path

      console.log("LABELED TRANSCRIPT: '\n\n", labeledTranscript, '\n\n');

      if (labeledTranscript) {
        fs.writeFile(
          outputFilePath,
          JSON.stringify(labeledTranscript, null, 2),
        );
      }
    });
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
