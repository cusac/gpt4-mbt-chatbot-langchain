import { spawn } from 'child_process';
import { Readable } from 'stream';

// import dotenv
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const CHANNEL_URL = 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw';
const VIDEO_LIMIT = 5;

async function fetchVideos(
  channelUrl: string,
  limit: number,
): Promise<string[]> {
  // TODO: Implement fetching videos using YouTube Data API v3
  // Return an array of video URLs
}

async function callYouTubeApi(
  endpoint: string,
  params: Record<string, any>,
): Promise<any> {
  const key = process.env.YOUTUBE_API_KEY; // Replace with your own API key
  // let url = `https://www.googleapis.com/youtube/v3/${endpoint}`;
  let url = `https://youtube.googleapis.com/youtube/v3/${endpoint}`;
  params = Object.assign(
    {
      // part: 'snippet',
      // maxResults: 50,
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

async function getChannelVideos(youtubeLink: string): Promise<string[]> {
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

  // Construct the YouTube links from the video IDs
  const youtubeLinks = videoIds.map(
    (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`,
  );

  return youtubeLinks;
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
  const videoLink = 'https://www.youtube.com/watch?v=r9sN7v0QzGc'

  const videos = await getChannelVideos(videoLink);

  for (const video of videos) {
    console.log(`Processing video: ${video}`);

    try {
      await executeCommand('python', ['cli.py', video]);
    } catch (error) {
      console.error(`Failed to process video ${video}: ${error}`);
    }
  }
}

main();
