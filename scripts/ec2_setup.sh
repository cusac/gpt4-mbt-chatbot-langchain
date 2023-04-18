#!/bin/bash
aws s3 cp s3://yt-whisper-transcripts/utils.py .
aws s3 cp s3://yt-whisper-transcripts/cli.py .
VIDEO_ID="$1"
OUTPUT_FILE="${VIDEO_ID}__output.txt"
python3 cli.py "$VIDEO_ID" --output_dir=transcripts > "$OUTPUT_FILE" 2>&1
aws s3 cp transcripts/* s3://yt-whisper-transcripts/transcripts/
aws s3 cp "$OUTPUT_FILE" s3://yt-whisper-transcripts/transcripts/
PYTHON_OUTPUT=$(cat "$OUTPUT_FILE")
aws sns publish --topic-arn "arn:aws:sns:REGION:ACCOUNT_ID:your-sns-topic" --message "EC2 instance processing completed. Output: $PYTHON_OUTPUT"
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
aws ec2 terminate-instances --instance-ids $INSTANCE_ID
