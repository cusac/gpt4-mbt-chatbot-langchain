import os
import whisper
from whisper.tokenizer import LANGUAGES, TO_LANGUAGE_CODE
import argparse
import warnings
import yt_dlp as youtube_dl
from utils_google import slugify, str2bool, write_srt, write_vtt, youtube_dl_log
import tempfile
from urllib.parse import urlparse, parse_qs
import time
import requests
import json
from google.cloud import speech_v1p1beta1 as speech
from pydub import AudioSegment

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
        result = transcribe_google_speech(audio_path)  # Use the new function
        warnings.filterwarnings("default")

        if (subtitles_format == 'vtt'):
            parsed_url = urlparse(url[0])
            query_string = parse_qs(parsed_url.query)
            video_id = query_string["v"][0]
            vtt_path = os.path.join(output_dir, f"{video_id}_{slugify(title)}.vtt")
            with open(vtt_path, 'w', encoding="utf-8") as vtt:
                write_vtt(result, file=vtt, line_length=break_lines, vidURL=url, vidTitle=title)


            print("Saved VTT to", os.path.abspath(vtt_path))
        else:
            srt_path = os.path.join(output_dir, f"{slugify(title)}.srt")
            with open(srt_path, 'w', encoding="utf-8") as srt:
                write_srt(result["segments"], file=srt, line_length=break_lines)

            print("Saved SRT to", os.path.abspath(srt_path))

    end_time = time.time()
    elapsed_time = end_time - start_time
    print(f"The script took {elapsed_time:.2f} seconds to complete.")

# def transcribe_google_speech(audio_path):
#     client = speech.SpeechClient()

#     with open(audio_path, "rb") as audio_file:
#         content = audio_file.read()

#     audio = speech.RecognitionAudio(content=content)


#     # Extract the sample rate from the audio file
#     audio_segment = AudioSegment.from_file(audio_path)
#     sample_rate_hertz = audio_segment.frame_rate

#     diarization_config = speech.SpeakerDiarizationConfig(
#         enable_speaker_diarization=True,
#         min_speaker_count=2,
#         max_speaker_count=10,
#     )

#     config = speech.RecognitionConfig(
#         encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
#         sample_rate_hertz=sample_rate_hertz,
#         language_code="en-US",
#         diarization_config=diarization_config,
#     )

#     response = client.recognize(config=config, audio=audio)

#     # Extract words_info and group words by speaker_tag
#     result = response.results[-1]
#     words_info = result.alternatives[0].words
#     speaker_groups = {}
#     for word_info in words_info:
#         speaker_tag = word_info.speaker_tag
#         if speaker_tag not in speaker_groups:
#             speaker_groups[speaker_tag] = []
#         speaker_groups[speaker_tag].append(word_info.word)

#     # Create a list of segments from speaker_groups
#     segments = []
#     for speaker, words in speaker_groups.items():
#         segment = {
#             "speaker": f"SPEAKER {speaker}",
#             "text": ' '.join(words)
#         }
#         segments.append(segment)

#     return {"segments": segments}

def split_audio_by_duration(audio_segment, chunk_length_ms):
    audio_chunks = []
    audio_length_ms = len(audio_segment)

    for start_ms in range(0, audio_length_ms, chunk_length_ms):
        end_ms = start_ms + chunk_length_ms
        chunk = audio_segment[start_ms:end_ms]
        audio_chunks.append(chunk)

    return audio_chunks

def transcribe_google_speech(audio_path):
    client = speech.SpeechClient()

    audio_segment = AudioSegment.from_file(audio_path)
    audio_segment = audio_segment.set_channels(1)  # Convert audio to mono
    sample_rate_hertz = audio_segment.frame_rate
    chunk_length_ms = 10 * 1000  # 10 seconds
    audio_chunks = split_audio_by_duration(audio_segment, chunk_length_ms)

    all_transcripts = []

    # Process each audio chunk
    for i, audio_chunk in enumerate(audio_chunks):
        print(f"Processing chunk {i+1}/{len(audio_chunks)}")
        audio_data = audio_chunk.export(format="wav").read()
        audio = speech.RecognitionAudio(content=audio_data)

        diarization_config = speech.SpeakerDiarizationConfig(
            enable_speaker_diarization=True,
            min_speaker_count=2,
            max_speaker_count=10,
        )

        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=sample_rate_hertz,
            language_code="en-US",
            diarization_config=diarization_config,
        )

        response = client.recognize(config=config, audio=audio)

        print("RESPONSE:", response)

        segments = []

        for result in response.results:
            alternative = result.alternatives[0]
            speaker_tag = 0
            for word_info in alternative.words:
                word = word_info.word
                start_time = word_info.start_time
                end_time = word_info.end_time
                speaker_tag = word_info.speaker_tag

                segments.append({
                    "text": word,
                    "start_time": start_time.total_seconds(),
                    "end_time": end_time.total_seconds(),
                    "speaker_tag": speaker_tag
                })

    return segments


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