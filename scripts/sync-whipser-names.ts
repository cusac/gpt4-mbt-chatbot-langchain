import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * This script is used to update the MBT video database with the latest whisper doc names
 */

let mbtToken = '';
let videosWithoutWhisperDoc: {
  title: string;
  ytId: string;
  whisperDoc: string;
}[] = [];

async function extractYouTubeLink(html: string) {
  const regex = /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[^"\s&']+/;
  const match = html.match(regex);
  return match ? match[0] : null;
}

function extractVideoId(ytLink: string) {
  const ytRegex =
    /^(?:https?:\/\/)?(?:www\.)?(?:youtu(?:\.be\/|be\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)))([\w\-]{10,12})(?:[\&\?](?:t=([0-9hms]{1,9}|[0-9]{1,9})))?.*$/;
  const match = ytLink.match(ytRegex);

  if (match && match[1]) {
    return match[1];
  } else {
    throw new Error('Invalid YouTube link.');
  }
}

async function loginToMbt() {
  const endpoint = `${process.env.MBT_API_URL}/login`;
  const body = {
    email: process.env.MBT_EMAIL,
    password: process.env.MBT_PASSWORD,
  };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    // Check if response is ok
    if (!response.ok) {
      throw new Error('Error logging in to MBT.', data);
    }
    // console.log('DATA:', data);
    const { refreshToken } = data;
    mbtToken = refreshToken;
  } catch (err) {
    console.error(err);
    throw new Error('Error logging in to MBT.');
  }
  return;
}

async function getVideoIdsNeedingWhisperUpdate() {
  const endpoint = `${process.env.MBT_API_URL}/list-videos-missing-whisper`;
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mbtToken}`,
      },
    });

    const data = await response.json();

    // Check if response is ok
    if (!response.ok) {
      throw new Error('Error getting videos needing whisper update.', data);
    }

    videosWithoutWhisperDoc = data;
  } catch (err) {
    console.error(err);
    throw new Error('Error getting videos needing whisper update.');
  }
}

async function saveDocName(videoId: string, docPath: string) {
  // Get filename from path
  const filename = path.basename(docPath);
  const endpoint = `${process.env.MBT_API_URL}/update-video-whisper`;
  const body = {
    videoId,
    whisperDoc: filename,
  };
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mbtToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  // Check if response is ok
  if (!response.ok) {
    console.log('Error saving doc name: ', data);
    throw new Error(
      `Error saving doc name: ${filename} for video: ${videoId}`,
      data,
    );
  }
}

async function processDocxFile(inputDocxPath: string) {
  try {
    const { value: html } = await mammoth.convertToHtml({
      path: inputDocxPath,
    });
    const youTubeLink = await extractYouTubeLink(html);
    const videoId = extractVideoId(youTubeLink || '');

    if (videoId) {
      // Skip file if video is not in the list of videos needing whisper update
      const video = videosWithoutWhisperDoc.find(
        (video) => video.ytId === videoId,
      );
      if (!video) {
        console.log(
          `Skipping file: ${inputDocxPath} because video: ${videoId} is not in the list of videos needing whisper update.`,
        );
        return;
      }

      // write doc path to endpoint
      await saveDocName(videoId, inputDocxPath);
      console.log(`\n\nWhisper doc name saved for: ${inputDocxPath}\n\n`);
    } else {
      console.log(`\n\nNo YouTube link found in the .docx file: ${inputDocxPath}\n\n`);
    }
  } catch (error) {
    console.error('Error processing .docx file:', error);
  }
}

async function processAllDocxFiles(inputDirectoryPath: string): Promise<void> {
  try {
    const files = await fs.readdir(inputDirectoryPath);
    const docxFiles = files.filter((file) => path.extname(file) === '.docx');

    for (const docxFile of docxFiles) {
      const inputDocxPath = path.join(inputDirectoryPath, docxFile);

      await processDocxFile(inputDocxPath);
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }
}

export const run = async () => {
  try {
    // Login to MBT and get video ids needing whisper update
    await Promise.all([loginToMbt(), getVideoIdsNeedingWhisperUpdate()]);
    // Create an absolute path to the relative path of "docs/With Timestamps"
    const inputDirectoryPath = path.join(process.cwd(), 'docs/With Timestamps');
    console.log('DOCS PATH', inputDirectoryPath);
    await processAllDocxFiles(inputDirectoryPath);
  } catch (error) {
    console.log('error', error);
    throw new Error('Failed to extract links');
  }
};

(async () => {
  await run();
  console.log('extraction complete');
})();
