#!/usr/bin/env python3
"""Parse a multi-month Greek Technical Safety schedule into monthly payloads."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pdfplumber


DATE_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{4})$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
SEPARATOR_RE = re.compile(r",\s*([012])\.\s*")
DURATION_RE = re.compile(r"(\d+)\s+ώρες\s+και\s+(\d+)\s+λεπτά", re.I)
ATHENS = ZoneInfo("Europe/Athens")


def clean_spaces(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    return re.sub(r"\s+,", ",", value)


def words_as_text(words: list[dict]) -> str:
    ordered = sorted(words, key=lambda word: (round(float(word["top"]), 1), float(word["x0"])))
    return clean_spaces(" ".join(str(word["text"]) for word in ordered))


def parse_visits(pdf_path: Path) -> list[dict]:
    visits: list[dict] = []
    with pdfplumber.open(pdf_path) as document:
        for page_number, page in enumerate(document.pages, 1):
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            anchors = sorted(
                (word for word in words if DATE_RE.fullmatch(str(word["text"]))),
                key=lambda word: float(word["top"]),
            )

            for index, date_word in enumerate(anchors):
                anchor_y = float(date_word["top"])
                previous_y = float(anchors[index - 1]["top"]) if index else anchor_y - 40
                next_y = float(anchors[index + 1]["top"]) if index + 1 < len(anchors) else anchor_y + 40
                low, high = (previous_y + anchor_y) / 2, (anchor_y + next_y) / 2
                row_words = [word for word in words if low <= float(word["top"]) < high]

                time_words = [
                    word
                    for word in row_words
                    if TIME_RE.fullmatch(str(word["text"]))
                    and abs(float(word["top"]) - anchor_y) <= 2
                ]
                if len(time_words) != 1:
                    raise ValueError(
                        f"page {page_number}: expected one time beside {date_word['text']}, "
                        f"found {len(time_words)}"
                    )
                time_word = time_words[0]

                if float(time_word["x0"]) < 90:
                    duration_start, organization_start = 95.0, 150.0
                else:
                    duration_start, organization_start = 132.0, 205.0

                duration_text = words_as_text(
                    [
                        word
                        for word in row_words
                        if duration_start <= float(word["x0"]) < organization_start
                    ]
                )
                organization_text = words_as_text(
                    [word for word in row_words if float(word["x0"]) >= organization_start]
                )
                duration_match = DURATION_RE.search(duration_text)
                if not duration_match:
                    raise ValueError(
                        f"page {page_number}: invalid duration at "
                        f"{date_word['text']} {time_word['text']}: {duration_text!r}"
                    )
                duration_minutes = int(duration_match.group(1)) * 60 + int(duration_match.group(2))
                if duration_minutes <= 0 or duration_minutes > 1440:
                    raise ValueError(
                        f"page {page_number}: invalid positive duration at "
                        f"{date_word['text']} {time_word['text']}"
                    )

                separator = SEPARATOR_RE.search(organization_text)
                if not separator:
                    raise ValueError(
                        f"page {page_number}: missing company/location delimiter at "
                        f"{date_word['text']} {time_word['text']}"
                    )
                company = clean_spaces(organization_text[: separator.start()])
                location = clean_spaces(organization_text[separator.end() :])
                location = clean_spaces(re.sub(r"\bnull\b", "", location, flags=re.I))
                location = re.sub(r",\s*$", "", location).strip()
                if not company:
                    raise ValueError(
                        f"page {page_number}: missing company at {date_word['text']} {time_word['text']}"
                    )

                start = datetime.strptime(
                    f"{date_word['text']} {time_word['text']}", "%d-%m-%Y %H:%M"
                ).replace(tzinfo=ATHENS)
                logical_source = f"{start.year:04d}_{start.month:02d}.pdf"
                visit_at = start.isoformat(timespec="seconds")
                sync_key = f"TA-SYNC|{logical_source}|{visit_at}|{company}"
                if len(sync_key) > 180:
                    raise ValueError(f"identifier exceeds 180 characters: {sync_key}")

                visits.append(
                    {
                        "sourceFile": logical_source,
                        "syncKey": sync_key,
                        "company": company,
                        "visitAt": visit_at,
                        "durationMinutes": duration_minutes,
                        "location": location,
                        "notes": sync_key,
                        "reminderAt": None,
                        "completed": False,
                    }
                )

    return sorted(visits, key=lambda item: (item["visitAt"], item["company"]))


def write_payloads(
    visits: list[dict], pdf_path: Path, output_dir: Path, today: date
) -> dict:
    current_month = (today.year, today.month)
    future_visits = []
    ignored_past = 0
    for visit in visits:
        timestamp = datetime.fromisoformat(visit["visitAt"])
        if (timestamp.year, timestamp.month) < current_month:
            ignored_past += 1
        else:
            future_visits.append(visit)

    if not future_visits:
        raise ValueError("the schedule contains no current or future visits")

    identifiers = [visit["syncKey"] for visit in future_visits]
    if len(identifiers) != len(set(identifiers)):
        duplicates = [key for key, count in Counter(identifiers).items() if count > 1]
        raise ValueError(f"duplicate TA-SYNC identifiers: {duplicates}")

    grouped: dict[str, list[dict]] = defaultdict(list)
    for visit in future_visits:
        grouped[visit["sourceFile"]].append({key: value for key, value in visit.items() if key != "sourceFile"})

    if len(grouped) > 24:
        raise ValueError(f"refusing an unexpectedly large {len(grouped)}-month schedule")

    output_dir.mkdir(parents=True, exist_ok=True)
    checksum = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    months = []
    for source_file in sorted(grouped):
        monthly_visits = grouped[source_file]
        if len(monthly_visits) > 300:
            raise ValueError(f"{source_file} exceeds the 300-visit backend limit")
        payload = {
            "owner": "elias",
            "sourceFile": source_file,
            "sourceChecksum": checksum,
            "dryRun": True,
            "visits": monthly_visits,
        }
        payload_path = output_dir / f"{source_file.removesuffix('.pdf')}.json"
        payload_path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        months.append(
            {
                "month": source_file.removesuffix(".pdf"),
                "sourceFile": source_file,
                "count": len(monthly_visits),
                "payload": payload_path.name,
            }
        )

    manifest = {
        "physicalSource": pdf_path.name,
        "sourceChecksum": checksum,
        "total": len(future_visits),
        "ignoredPast": ignored_past,
        "months": months,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--today", help="Athens date in YYYY-MM-DD; defaults to today in Athens")
    args = parser.parse_args()

    if args.pdf.name != "technical_safety_schedule.pdf":
        raise ValueError("the exact physical source name must be technical_safety_schedule.pdf")
    if not args.pdf.is_file() or args.pdf.stat().st_size == 0:
        raise ValueError(f"missing or empty PDF: {args.pdf}")

    today = (
        date.fromisoformat(args.today)
        if args.today
        else datetime.now(ATHENS).date()
    )
    manifest = write_payloads(parse_visits(args.pdf), args.pdf, args.output_dir, today)
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
