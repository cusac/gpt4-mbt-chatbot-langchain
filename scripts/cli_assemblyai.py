import os
import whisper
from whisper.tokenizer import LANGUAGES, TO_LANGUAGE_CODE
import argparse
import warnings
import yt_dlp as youtube_dl
from utils_assemblyai import slugify, str2bool, write_srt, write_vtt, youtube_dl_log
import tempfile
from urllib.parse import urlparse, parse_qs
import time
import requests
import json

# API_KEY = "your_assemblyai_api_key"

def main():
    start_time = time.time()
    parser = argparse.ArgumentParser(
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("video", nargs="+", type=str,
                        help="video URLs to transcribe")
    parser.add_argument("--model", default="tiny.en",
                        choices=whisper.available_models(), help="name of the Whisper model to use")
    parser.add_argument("--format", default="vtt",
                        choices=["vtt", "srt"], help="the subtitle format to output")
    parser.add_argument("--output_dir", "-o", type=str,
                        default=".", help="directory to save the outputs")
    parser.add_argument("--verbose", type=str2bool, default=False,
                        help="Whether to print out the progress and debug messages")
    parser.add_argument("--task", type=str, default="transcribe", choices=[
                        "transcribe", "translate"], help="whether to perform X->X speech recognition ('transcribe') or X->English translation ('translate')")
    parser.add_argument("--language", type=str, default=None, choices=sorted(LANGUAGES.keys()) + sorted([k.title() for k in TO_LANGUAGE_CODE.keys()]),
                        help="language spoken in the audio, skip to perform language detection")

    parser.add_argument("--break-lines", type=int, default=0, 
                        help="Whether to break lines into a bottom-heavy pyramid shape if line length exceeds N characters. 0 disables line breaking.")
    parser.add_argument("--duration_limit", type=int, default=None,
                        help="Limit the duration of the audio file in seconds (default: no limit)")

    args = parser.parse_args().__dict__
    duration_limit = args.pop("duration_limit")
    model_name: str = args.pop("model")
    output_dir: str = args.pop("output_dir")
    subtitles_format: str = args.pop("format")
    os.makedirs(output_dir, exist_ok=True)

    if model_name.endswith(".en"):
        warnings.warn(
            f"{model_name} is an English-only model, forcing English detection.")
        args["language"] = "en"

    model = whisper.load_model(model_name)
    url = args.pop("video")
    audios = get_audio(url, duration_limit)
    break_lines = args.pop("break_lines")

    for title, audio_path in audios.items():
        warnings.filterwarnings("ignore")
        # result = model.transcribe(audio_path, **args)
        result = transcribe_assemblyai(audio_path) # AssemblyAI
        warnings.filterwarnings("default")

        if (subtitles_format == 'vtt'):
            parsed_url = urlparse(url[0])
            query_string = parse_qs(parsed_url.query)
            video_id = query_string["v"][0]
            vtt_path = os.path.join(output_dir, f"{video_id}_{slugify(title)}.vtt")
            with open(vtt_path, 'w', encoding="utf-8") as vtt:
                write_vtt(result["segments"], file=vtt, line_length=break_lines, vidURL=url, vidTitle=title )

            print("Saved VTT to", os.path.abspath(vtt_path))
        else:
            srt_path = os.path.join(output_dir, f"{slugify(title)}.srt")
            with open(srt_path, 'w', encoding="utf-8") as srt:
                write_srt(result["segments"], file=srt, line_length=break_lines)

            print("Saved SRT to", os.path.abspath(srt_path))

    end_time = time.time()
    elapsed_time = end_time - start_time
    print(f"The script took {elapsed_time:.2f} seconds to complete.")


def transcribe_assemblyai(audio_path):
    base_url = "https://api.assemblyai.com/v2"

    headers = {
        "authorization": API_KEY
    }

    with open(audio_path, "rb") as f:
        response = requests.post(base_url + "/upload",
                                 headers=headers,
                                 data=f)

    upload_url = response.json()["upload_url"]

    data = {
        "audio_url": upload_url,
        "speaker_labels": True
    }

    url = base_url + "/transcript"
    response = requests.post(url, json=data, headers=headers)

    transcript_id = response.json()['id']
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
        "text": f"SPEAKER {current_speaker}\n\n{words[0]['text']} "
    }

    for word in words[1:]:
        if word['speaker'] != current_speaker:
            formatted_transcript.append(segment)
            current_speaker = word['speaker']
            segment = {
                "start": word['start'],
                "end": word['end'],
                "text": f"\n\nSPEAKER {current_speaker}\n\n{word['text']} "
            }
        else:
            segment["end"] = word['end']
            segment["text"] += f" {word['text']}"

    formatted_transcript.append(segment)
    return formatted_transcript

def get_audio(urls, duration_limit=None):
    temp_dir = tempfile.gettempdir()

    ydl_opts = {
        'quiet': True,
        'verbose': False,
        'no_warnings': True,
        'format': 'bestaudio/best',
        "outtmpl": os.path.join(temp_dir, "%(id)s.%(ext)s"),
        'progress_hooks': [youtube_dl_log],
        'postprocessors': [{
            'preferredcodec': 'mp3',
            'preferredquality': '192',
            'key': 'FFmpegExtractAudio',
        }],
    }

    if duration_limit:
        ydl_opts['postprocessor_args'] = [
            '-t', str(duration_limit)
        ]

    ydl = youtube_dl.YoutubeDL(ydl_opts)

    paths = {}

    for url in urls:
        result = ydl.extract_info(url, download=True)
        print(
            f"Downloaded video \"{result['title']}\". Generating subtitles..."
        )
        paths[result["title"]] = os.path.join(temp_dir, f"{result['id']}.mp3")

    return paths


if __name__ == '__main__':
    main()