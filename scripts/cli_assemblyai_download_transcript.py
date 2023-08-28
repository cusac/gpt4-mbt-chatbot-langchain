import os
import whisper
from whisper.tokenizer import LANGUAGES, TO_LANGUAGE_CODE
import argparse
import warnings
import yt_dlp as youtube_dl
from utils_assemblyai import slugify, str2bool, write_transcript, youtube_dl_log
import tempfile
from urllib.parse import urlparse, parse_qs
import time
import requests
import json
from dotenv import load_dotenv


load_dotenv()  # take environment variables from .env.
API_KEY = os.getenv("API_KEY")  # Replace with your AssemblyAI API key.


def main():
    start_time = time.time()
    parser = argparse.ArgumentParser(
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("video", type=str,
                        help="video URL, used for the output filename")
    parser.add_argument("id", type=str,
                        help="assemblyai id to fetch")
    parser.add_argument("--output_dir", "-o", type=str,
                        default="./1_labeled_transcripts", help="directory to save the outputs")

    args = parser.parse_args().__dict__
    id: str = args.pop("id")
    output_dir: str = args.pop("output_dir")
    url: str = args.pop("video")
    os.makedirs(output_dir, exist_ok=True)

    ydl = youtube_dl.YoutubeDL({'quiet': True, 'no_warnings': True})
    print ("Downloading video from YouTube: " + url)
    info_dict = ydl.extract_info(url, download=False)

    file_exists, output_path = check_output_file_exists(url, output_dir, info_dict)

    if file_exists:
        return

    warnings.filterwarnings("ignore")
    # result = model.transcribe(audio_path, **args)
    result = download_transcript(id)  # AssemblyAI
    warnings.filterwarnings("default")

    with open(output_path, 'w', encoding="utf-8") as transcript_file:
        write_transcript(result["segments"], file=transcript_file)

    print("Saved transcript to", os.path.abspath(output_path))

    end_time = time.time()
    elapsed_time = end_time - start_time
    print(f"The script took {elapsed_time:.2f} seconds to complete.")


def download_transcript(transcript_id):
    print ("Downloading transcript from AssemblyAI...")
    headers = {
        "authorization": API_KEY
    }

    polling_endpoint = f"https://api.assemblyai.com/v2/transcript/{transcript_id}"

    while True:
        transcription_result = requests.get(polling_endpoint, headers=headers).json()

        if transcription_result['status'] == 'completed':
            formatted_transcript = format_transcript(transcription_result)
            return {"segments": formatted_transcript}

        elif transcription_result['status'] == 'error':
            raise RuntimeError(f"Transcription failed: {transcription_result['error']}")

        else:
            time.sleep(3)

def format_transcript(transcription_result):
    formatted_transcript = []
    words = transcription_result['words']
    current_speaker = words[0]['speaker']

    segment = {
        "start": words[0]['start'],
        "end": words[0]['end'],
        "text": f"SPEAKER_{current_speaker}\n\n{words[0]['text']} "
    }

    for word in words[1:]:
        if word['speaker'] != current_speaker:
            formatted_transcript.append(segment)
            current_speaker = word['speaker']
            segment = {
                "start": word['start'],
                "end": word['end'],
                "text": f"\n\nSPEAKER_{current_speaker}\n\n{word['text']} "
            }
        else:
            segment["end"] = word['end']
            segment["text"] += f" {word['text']}"

    formatted_transcript.append(segment)
    return formatted_transcript


def check_output_file_exists(url, output_dir, info_dict):
    title = info_dict.get('title', None)
    parsed_url = urlparse(url)
    query_string = parse_qs(parsed_url.query)
    video_id = query_string.get("v", [None])[0]
    output_path = os.path.join(output_dir, f"{video_id}_{slugify(title)}.txt")

    if os.path.isfile(output_path):
        print(f"Output file {output_path} already exists. Skipping this video...")
        return True, output_path
    return False, output_path

if __name__ == '__main__':
    main()