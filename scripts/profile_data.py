"""Read the reference ZIP and report aggregate data quality without extracting it."""

import argparse
import csv
import hashlib
import io
import json
import statistics
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile


NUTRIENT_PAIRS = (
    ("N_CHO", "NF_CHO"),
    ("N_SUGAR", "NF_SUGAR"),
    ("N_EN", "NF_EN"),
    ("N_PROT", "NF_PROT"),
    ("N_FAT", "NF_FAT"),
)
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def profile_csv(header, rows):
    report = {
        "rows": len(rows),
        "columns": header,
        "blank_counts": {
            column: sum(not row[column].strip() for row in rows)
            for column in header
        },
        "exact_duplicate_rows": len(rows)
        - len({tuple(row[column] for column in header) for row in rows}),
    }
    if "ID" in header:
        report["unique_IDs"] = len({row["ID"] for row in rows})
    for column in (
        "YEAR", "SEX", "HE_DM_HB", "영양성분함량기준량",
        "데이터구분명", "제공기관명",
    ):
        if column in header:
            report[column + "_counts"] = dict(Counter(row[column] for row in rows))
    for column in ("AGE", "HE_BMI", "HE_GLU", "HE_HBA1C"):
        if column in header:
            values = [float(row[column]) for row in rows if row[column].strip()]
            report[column + "_range"] = (
                {"min": min(values), "max": max(values), "median": statistics.median(values)}
                if values else None
            )
    for column in ("N_FCODE", "식품코드"):
        if column in header:
            report["unique_food_codes"] = len({row[column] for row in rows})
    return report


def read_food_codebook(archive, member):
    """Resolve the food-code sheet by name; keep codes as strings."""
    with ZipFile(io.BytesIO(archive.read(member))) as book:
        strings = []
        if "xl/sharedStrings.xml" in book.namelist():
            root = ET.fromstring(book.read("xl/sharedStrings.xml"))
            strings = [
                "".join(node.text or "" for node in item.findall(".//m:t", NS))
                for item in root.findall("m:si", NS)
            ]
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        sheets = workbook.findall("m:sheets/m:sheet", NS)
        food_sheet = next(sheet for sheet in sheets if sheet.get("name") == "식품코드")
        rel_id = food_sheet.get(
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        )
        relationships = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        target = next(rel.get("Target") for rel in relationships if rel.get("Id") == rel_id)
        sheet_path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        root = ET.fromstring(book.read(sheet_path))
        codes = set()
        for row in root.findall("m:sheetData/m:row", NS)[1:]:
            cell = next((cell for cell in row.findall("m:c", NS)
                         if cell.get("r", "").rstrip("0123456789") == "A"), None)
            if cell is None:
                continue
            value_node = cell.find("m:v", NS)
            value = value_node.text if value_node is not None else "".join(
                node.text or "" for node in cell.findall(".//m:t", NS)
            )
            if cell.get("t") == "s":
                value = strings[int(value)]
            if value:
                codes.add(value)
        return {"sheet_names": [sheet.get("name") for sheet in sheets],
                "food_codes": codes}


def build_report(archive_path):
    digest = hashlib.sha256()
    with archive_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    tables = {}
    profiles = {}
    with ZipFile(archive_path) as archive:
        for member in archive.infolist():
            if not member.filename.lower().endswith(".csv"):
                continue
            with archive.open(member) as source:
                reader = csv.DictReader(io.TextIOWrapper(source, encoding="utf-8-sig", newline=""))
                rows = list(reader)
                header = reader.fieldnames or []
            if any(None in row or any(value is None for value in row.values()) for row in rows):
                raise ValueError(f"Malformed CSV row in {member.filename}")
            tables[member.filename] = rows
            profiles[member.filename] = profile_csv(header, rows)
        health = next(rows for rows in tables.values() if rows and "HE_GLU" in rows[0])
        intake = next(rows for rows in tables.values() if rows and "NF_EN" in rows[0])
        foods = next(rows for rows in tables.values() if rows and "식품코드" in rows[0])
        health_ids = {row["ID"] for row in health}
        intake_ids = {row["ID"] for row in intake}
        intake_codes = {row["N_FCODE"] for row in intake}
        food_codes = {row["식품코드"] for row in foods}
        member = next(name for name in archive.namelist() if name.lower().endswith(".xlsx"))
        codebook = read_food_codebook(archive, member)
        normalized_codes = {code.zfill(5) for code in intake_codes}
        joins = {
            "health_IDs": len(health_ids), "intake_IDs": len(intake_ids),
            "intersection": len(health_ids & intake_ids),
            "health_only": len(health_ids - intake_ids),
            "intake_only": len(intake_ids - health_ids),
            "food_catalog_exact_code_overlap": len(intake_codes & food_codes),
            "codebook_food_codes": len(codebook["food_codes"]),
            "codebook_matches_after_zfill_5": len(normalized_codes & codebook["food_codes"]),
            "codebook_unmatched_after_zfill_5": len(normalized_codes - codebook["food_codes"]),
        }
    sums = defaultdict(lambda: defaultdict(float))
    for row in intake:
        for _, detail_column in NUTRIENT_PAIRS:
            if row[detail_column].strip():
                sums[row["ID"]][detail_column] += float(row[detail_column])
    reconciliation = {}
    for total_column, detail_column in NUTRIENT_PAIRS:
        differences = [
            abs(float(row[total_column]) - sums[row["ID"]][detail_column])
            for row in health if row[total_column].strip() and row["ID"] in intake_ids
        ]
        reconciliation[total_column + " vs sum(" + detail_column + ")"] = {
            "compared": len(differences),
            "within_0.01": sum(difference <= 0.01 for difference in differences),
            "max_abs_difference": max(differences) if differences else None,
        }
    return {"archive": archive_path.name, "archive_sha256": digest.hexdigest(),
            "csv_profiles": profiles, "joins": joins,
            "codebook_sheets": codebook["sheet_names"],
            "nutrient_reconciliation": reconciliation}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "csv.zip")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.archive.resolve() == args.output.resolve():
        parser.error("Output must differ from the input archive.")
    report = build_report(args.archive)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Profile written: {args.output}")


if __name__ == "__main__":
    main()
