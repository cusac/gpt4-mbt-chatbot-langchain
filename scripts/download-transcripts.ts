import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import AWS from 'aws-sdk';

// import dotenv
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const EC2_KEY_PAIR = process.env.EC2_KEY_PAIR
const EC2_REGION = process.env.EC2_REGION
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY

if (!EC2_KEY_PAIR) {
  throw new Error('Missing EC2 Key Pair');
}
if (!EC2_REGION) {
  throw new Error('Missing EC2 Region');
}
if (!YOUTUBE_API_KEY) {
  throw new Error('Missing YouTube API Key');
}
if (!AWS_ACCESS_KEY_ID) {
  throw new Error('Missing AWS Access Key ID');
}
if (!AWS_SECRET_ACCESS_KEY) {
  throw new Error('Missing AWS Secret Access Key');
}

async function callYouTubeApi(
  endpoint: string,
  params: Record<string, any>,
): Promise<any> {
  let url = `https://youtube.googleapis.com/youtube/v3/${endpoint}`;
  params = Object.assign(
    {
      key: YOUTUBE_API_KEY,
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

  // Configure AWS SDK
  AWS.config.update({ region: EC2_REGION }); // Set the region according to your preference
  const ec2 = new AWS.EC2();
  const s3 = new AWS.S3();

  // Upload Python scripts to S3
  const scriptFiles = ['utils.py', 'cli.py'];
  for (const fileName of scriptFiles) {
    const fileContent = readFileSync(fileName);
    await s3
      .putObject({
        Bucket: 'yt-whisper-transcripts',
        Key: fileName,
        Body: fileContent,
      })
      .promise();
  }

  const { channelId, videoIds } = await getChannelVideos(videoLink);

  for (const videoId of videoIds) {
    const videoLink = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      // Check if the transcript already exists in S3
      const transcriptObjects = await s3
        .listObjectsV2({
          Bucket: 'yt-whisper-transcripts',
          Prefix: `transcripts/${videoId}`,
        })
        .promise();

      if (transcriptObjects.Contents.length > 0) {
        console.log(
          `Transcript for video ${videoId} already exists, skipping...`,
        );
        continue;
      }

      // Create EC2 instance
      const userData = `#!/bin/bash
  aws s3 cp s3://yt-whisper-transcripts/ec2_setup.sh .
  chmod +x ec2_setup.sh
  ./ec2_setup.sh "${videoLink}"
  `;
      const base64UserData = Buffer.from(userData).toString('base64');

      const instanceParams = {
        ImageId: 'ami-id', // Replace with the AMI ID that has all required dependencies
        InstanceType: 't2.micro',
        MinCount: 1,
        MaxCount: 1,
        KeyName: EC2_KEY_PAIR, // Replace with your key pair name
        UserData: base64UserData,
      };

      ec2
        .runInstances(instanceParams)
        .promise()
        .then((instance: any) => {
          const instanceId = instance.Instances[0].InstanceId;
          console.log(`Created EC2 instance with ID ${instanceId}`);

          // Wait for the instance to finish and then terminate it
          const waiter = new AWS.EC2({ region: EC2_REGION }).waitFor(
            'instanceStatusOk',
            {
              InstanceIds: [instanceId],
            },
          );
          waiter.promise().then((resp) => {
            console.log(resp);
            console.log(
              `Instance ${instanceId} is running and processing video: ${videoLink}`,
            );
          });
        });
    } catch (error) {
      console.error(`Failed to process video ${videoLink}: ${error}`);
    }
  }
}

main();
