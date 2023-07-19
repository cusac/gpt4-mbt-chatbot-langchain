import { readFileSync } from 'fs';
//@ts-ignore
import AWS from 'aws-sdk';
import AWS_SSM from 'aws-sdk/clients/ssm';

// import dotenv
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const EC2_KEY_PAIR = process.env.EC2_KEY_PAIR;
const EC2_REGION = process.env.EC2_REGION;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AMI_ID = process.env.AMI_ID;

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
if (!AMI_ID) {
  throw new Error('Missing AMI ID');
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

  // return last 10 videos
  return { channelId, videoIds: ['iLDST05OSTs'] };

  // return { channelId, videoIds };
}

async function getInstanceOutput(
  ssm: AWS_SSM,
  commandId: string,
  instanceId: string,
) {
  try {
    const params = {
      CommandId: commandId,
      InstanceId: instanceId,
    };
    const result = await ssm.getCommandInvocation(params).promise();

    if (result.Status === 'InProgress') {
      setTimeout(() => getInstanceOutput(ssm, commandId, instanceId), 5000);
    } else {
      console.log(`Output for instance ${instanceId}:`);
      console.log(result.StandardOutputContent);
    }
  } catch (error) {
    console.error(
      `Failed to get command output for instance ${instanceId}: ${error}`,
    );
  }
}

async function createEc2Instance(
  ec2: AWS.EC2,
  videoLink: string,
  instanceParams: AWS.EC2.RunInstancesRequest,
  attempt = 1,
) {
  ec2
    .runInstances(instanceParams)
    .promise()
    .then(async (instance: any) => {
      const instanceId = instance.Instances[0].InstanceId;
      console.log(`Created EC2 instance with ID ${instanceId}`);

      // Wait for the instance to be in a 'running' state
      await ec2
        .waitFor('instanceStatusOk', {
          InstanceIds: [instanceId],
        })
        .promise();

      // Add a small delay before sending the command
      await new Promise((resolve) => setTimeout(resolve, 30000));

      // Send the command using the AWS Systems Manager (SSM)
      const ssm = new AWS_SSM({ region: EC2_REGION });
      const commandParams = {
        DocumentName: 'AWS-RunShellScript',
        InstanceIds: [instanceId],
        Parameters: {
          commands: [
            'aws s3 cp s3://yt-whisper-transcripts/ec2_setup.sh .',
            'chmod +x ec2_setup.sh',
            `./ec2_setup.sh "${videoLink}"`,
          ],
        },
      };

      const commandResult = await ssm.sendCommand(commandParams).promise();
      const commandId = commandResult?.Command?.CommandId;

      if (!commandId) {
        console.log('ERROR: Unable to send command to instance');
      } else {
        // Get the command output
        getInstanceOutput(ssm, commandId, instanceId);
      }
    })
    .catch(async (err: any) => {
      if (err.code === 'RequestLimitExceeded' && attempt <= 5) {
        const backoffTime = Math.pow(2, attempt) * 1000;
        console.log(`Request limit exceeded. Retrying in ${backoffTime} ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        createEc2Instance(ec2, videoLink, instanceParams, attempt + 1);
      } else {
        console.log('ERROR CREATING INSTANCE: ', err);
      }
    });
}

async function main() {
  const videoLink = 'https://www.youtube.com/watch?v=iLDST05OSTs';

  // Configure AWS SDK
  AWS.config.update({
    region: EC2_REGION,
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  }); // Set the region according to your preference
  const ec2 = new AWS.EC2();
  const s3 = new AWS.S3();

  // Upload Python scripts to S3
  const scriptFiles = ['utils.py', 'cli.py', 'ec2_setup.sh'];
  for (const fileName of scriptFiles) {
    console.log(`Uploading ${fileName} to S3...`);
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
          Prefix: `transcripts/${channelId}/${videoId}`,
        })
        .promise();

      //@ts-ignore
      if (transcriptObjects?.Contents?.length > 0) {
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

      const instanceParams: AWS.EC2.RunInstancesRequest = {
        ImageId: AMI_ID, // Replace with your AMI ID
        InstanceType: 't3.medium',
        KeyName: EC2_KEY_PAIR, // Replace with your key pair name
        UserData: base64UserData,
        SecurityGroupIds: ['sg-0337e03c7e0a7d65e'],
        MinCount: 1,
        MaxCount: 1,
        InstanceInitiatedShutdownBehavior: 'terminate',
        IamInstanceProfile: {
          Arn: 'arn:aws:iam::005394478046:instance-profile/send-ssm-ec2',
        },

        // Add the following lines for Spot Instances
        InstanceMarketOptions: {
          MarketType: 'spot',
          SpotOptions: {
            MaxPrice: '0.10', // Maximum hourly price you're willing to pay for the instance
            SpotInstanceType: 'one-time',
          },
        },
      };

      createEc2Instance(ec2, videoLink, instanceParams);
      return;
    } catch (error) {
      console.error(`Failed to process video ${videoLink}: ${error}`);
    }
  }
}

main();
