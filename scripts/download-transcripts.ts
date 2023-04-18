import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// import dotenv
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

async function callYouTubeApi(
  endpoint: string,
  params: Record<string, any>,
): Promise<any> {
  const key = process.env.YOUTUBE_API_KEY; // Replace with your own API key
  let url = `https://youtube.googleapis.com/youtube/v3/${endpoint}`;
  params = Object.assign(
    {
      key,
    },
    params,
  );

  let first = true;

  for (const paramKey in params) {
    if (params[paramKey]) {
      url = first
        ? `${url}?${paramKey}=${params[paramKey]}`
        : `${url}&${paramKey}=${params[paramKey]}`;
      first = false;
    }
  }

  console.log('FETCHING: ', url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `YouTube API request failed: ${response.status} ${response.statusText}`,
    );
  }

  return await response.json();
}

async function getChannelVideos(
  youtubeLink: string,
): Promise<{ channelId: string; videoIds: string[] }> {
  // Extract the video ID from the YouTube link
  const videoId = youtubeLink.match(/[?&]v=([^&]+)/)?.[1];

  if (!videoId) {
    throw new Error(`Invalid YouTube link: ${youtubeLink}`);
  }

  // Call the videos endpoint with the video ID
  const videosResponse = await callYouTubeApi('videos', {
    id: videoId,
    part: 'snippet',
  });

  // Extract the channel ID from the videos response
  const channelId = videosResponse.items[0]?.snippet.channelId;

  if (!channelId) {
    throw new Error(`Unable to determine channel ID for video ${videoId}`);
  }

  // Get the 'uploads' playlist ID
  const channelsResponse = await callYouTubeApi('channels', {
    id: channelId,
    part: 'contentDetails',
  });

  const uploadsPlaylistId =
    channelsResponse.items[0]?.contentDetails.relatedPlaylists.uploads;

  // Call the playlistItems endpoint with the channel ID
  const videoIds: string[] = [];
  let nextPageToken: string | undefined;

  do {
    const playlistItemsResponse = await callYouTubeApi('playlistItems', {
      playlistId: uploadsPlaylistId,
      part: 'contentDetails',
      maxResults: 50,
      pageToken: nextPageToken,
    });

    const items = playlistItemsResponse.items || [];
    const ids = items.map((item: any) => item.contentDetails.videoId);

    videoIds.push(...ids);
    nextPageToken = playlistItemsResponse.nextPageToken;
  } while (nextPageToken);

  return { channelId, videoIds };
}

async function executeCommand(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const childProcess = spawn(command, args);

    childProcess.stdout.pipe(process.stdout);
    childProcess.stderr.pipe(process.stderr);

    childProcess.on('error', (error: Error) => {
      reject(error);
    });

    childProcess.on('exit', (code: number) => {
      if (code !== 0) {
        reject(new Error(`Command failed with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  const videoLink = 'https://www.youtube.com/watch?v=r9sN7v0QzGc';

  const downloadedTranscriptsPath = './downloaded_transcripts.json';

  // Create the downloaded_transcripts.json file if it doesn't exist
  if (!existsSync(downloadedTranscriptsPath)) {
    writeFileSync(downloadedTranscriptsPath, '{}');
  }

  const downloadedTranscripts = JSON.parse(
    readFileSync(downloadedTranscriptsPath, 'utf-8'),
  );

  const { channelId, videoIds } = await getChannelVideos(videoLink);

  for (const videoId of videoIds) {

    const videoLink = `https://www.youtube.com/watch?v=${videoId}`;

    if (downloadedTranscripts[channelId]?.includes(videoId)) {
      console.log(`Skipping video ${videoLink} as it has already been processed`);
      continue;
    }

    console.log(`Processing video: ${videoLink}`);

    if (!downloadedTranscripts[channelId]) {
      downloadedTranscripts[channelId] = [];
    }

    try {
      await executeCommand('python', [
        'cli.py',
        videoLink,
        '--output_dir=transcripts',
      ]);

      downloadedTranscripts[channelId].push(videoId);

      writeFileSync(
        downloadedTranscriptsPath,
        JSON.stringify(downloadedTranscripts),
      );
    } catch (error) {
      console.error(`Failed to process video ${videoLink}: ${error}`);
    }
  }
}

main();
