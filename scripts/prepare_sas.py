"""Extract local KNHANES SAS archives and save metadata, without changing ZIPs."""

import argparse
import csv
import hashlib
import json
import re
import shutil
import zlib
from pathlib import Path
from zipfile import ZipFile

import pyreadstat


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_NAME = re.compile(r"HN(\d{2})_(ALL|24RC)\(SAS\)\.zip", re.IGNORECASE)


def fingerprint(path):
    digest = hashlib.sha256()
    crc = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
            crc = zlib.crc32(block, crc)
    return digest.hexdigest(), crc & 0xFFFFFFFF


def extract_dataset(archive, member, destination):
    """Keep existing matching files; refuse to overwrite a different file."""
    if destination.exists():
        digest, crc = fingerprint(destination)
        if destination.stat().st_size != member.file_size or crc != member.CRC:
            raise FileExistsError(f"Existing file differs from ZIP: {destination}")
        return digest
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with archive.open(member) as source, destination.open("xb") as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return fingerprint(destination)[0]


def prepare(data_dir):
    archives = sorted(path for path in data_dir.glob("*.zip") if ARCHIVE_NAME.fullmatch(path.name))
    if not archives:
        raise FileNotFoundError(f"No HNyy_ALL(SAS).zip or HNyy_24RC(SAS).zip in {data_dir}")
    metadata_dir = data_dir / "metadata" / "knhanes"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    inventory = []
    for source in archives:
        match = ARCHIVE_NAME.fullmatch(source.name)
        year = 2000 + int(match[1])
        expected_name = f"hn{match[1]}_{match[2].lower()}.sas7bdat"
        destination = data_dir / "raw" / "knhanes" / str(year) / expected_name
        archive_sha256 = fingerprint(source)[0]
        with ZipFile(source) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            if len(members) != 1 or members[0].filename.lower() != expected_name:
                raise ValueError(f"Unexpected archive contents: {source}")
            dataset_sha256 = extract_dataset(archive, members[0], destination)
        _, metadata = pyreadstat.read_sas7bdat(destination, metadataonly=True)
        dictionary = metadata_dir / f"{destination.stem}_columns.csv"
        with dictionary.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["name", "label", "readstat_type", "sas_format"])
            for name in metadata.column_names:
                writer.writerow([
                    name,
                    metadata.column_names_to_labels.get(name),
                    metadata.readstat_variable_types.get(name),
                    metadata.original_variable_types.get(name),
                ])
        inventory.append({
            "year": year,
            "kind": match[2].upper(),
            "archive": source.relative_to(data_dir).as_posix(),
            "archive_sha256": archive_sha256,
            "dataset": destination.relative_to(data_dir).as_posix(),
            "dataset_sha256": dataset_sha256,
            "bytes": destination.stat().st_size,
            "rows": metadata.number_rows,
            "columns": metadata.number_columns,
            "encoding": metadata.file_encoding,
            "file_label": metadata.file_label,
            "column_dictionary": dictionary.relative_to(data_dir).as_posix(),
        })
        print(f"{destination.name}: {metadata.number_rows:,} rows, "
              f"{metadata.number_columns:,} columns, {metadata.file_encoding}", flush=True)
    report = metadata_dir / "inventory.json"
    report.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Metadata saved: {report}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    prepare(parser.parse_args().data_dir.resolve())
