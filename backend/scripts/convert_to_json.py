"""
One-time conversion script: Excel lexicons + YAML config → JSON files for the migration data directory.

Usage:
    python scripts/convert_to_json.py

Reads from:
    ../../Python/00_Lists_and_Lexicons/000_Normalization_Lexicon.xlsx
    ../../Python/00_Lists_and_Lexicons/001_Labeling_Lexicon.xlsx
    ../../Python/00_Lists_and_Lexicons/NewVue_Linkage_Labeled.xlsx
    ../../Python/00_Lists_and_Lexicons/NewVue_Linkage_Raw.xlsx
    ../../Python/scoring_config.yaml

Writes to:
    ../data/normalization-lexicon.json
    ../data/labeling-lexicon.json
    ../data/scoring-config.json
    ../data/linkage-catalogue.json
"""

import json
import os
import sys
from datetime import date

import pandas as pd
import yaml

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
MIGRATION_DIR = os.path.abspath(os.path.join(BACKEND_DIR, ".."))
PROJECT_ROOT = os.path.abspath(os.path.join(MIGRATION_DIR, ".."))
PYTHON_DIR = os.path.join(PROJECT_ROOT, "Python")
LEXICON_DIR = os.path.join(PYTHON_DIR, "00_Lists_and_Lexicons")
DATA_DIR = os.path.join(MIGRATION_DIR, "data")

NORM_LEXICON_PATH = os.path.join(LEXICON_DIR, "000_Normalization_Lexicon.xlsx")
LABEL_LEXICON_PATH = os.path.join(LEXICON_DIR, "001_Labeling_Lexicon.xlsx")
LINKAGE_LABELED_PATH = os.path.join(LEXICON_DIR, "NewVue_Linkage_Labeled.xlsx")
LINKAGE_RAW_PATH = os.path.join(LEXICON_DIR, "NewVue_Linkage_Raw.xlsx")
SCORING_CONFIG_PATH = os.path.join(PYTHON_DIR, "scoring_config.yaml")

TODAY = date.today().isoformat()


def ensure_output_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def convert_normalization_lexicon():
    print(f"Reading normalization lexicon from: {NORM_LEXICON_PATH}")
    df = pd.read_excel(NORM_LEXICON_PATH, header=None)
    df = df.iloc[1:].reset_index(drop=True)

    entries = []
    skipped = 0
    for _, row in df.iterrows():
        raw = row.iloc[0]
        normalized = row.iloc[1] if len(row) > 1 else ""
        operation = row.iloc[2] if len(row) > 2 else ""

        if pd.isna(raw) or str(raw).strip() == "":
            skipped += 1
            continue

        raw = str(raw).strip()
        normalized = "" if pd.isna(normalized) else str(normalized).strip()
        operation = "" if pd.isna(operation) or str(operation).strip() == "" else str(operation).strip().lower()

        allowed_ops = {"", "replace", "end", "start", "delete"}
        if operation not in allowed_ops:
            print(f"  WARNING: Unknown operation '{operation}' for term '{raw}', setting to ''")
            operation = ""

        entry = {"raw": raw, "normalized": normalized}
        if operation:
            entry["operation"] = operation
        entries.append(entry)

    result = {
        "version": "1.0",
        "description": "Normalization lexicon for study name text replacement. Converted from 000_Normalization_Lexicon.xlsx.",
        "lastUpdated": TODAY,
        "totalEntries": len(entries),
        "entries": entries,
    }

    out_path = os.path.join(DATA_DIR, "normalization-lexicon.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"  OK: Wrote {len(entries)} entries to {out_path} (skipped {skipped} empty rows)")
    return len(entries)


def convert_labeling_lexicon():
    print(f"Reading labeling lexicon from: {LABEL_LEXICON_PATH}")
    df = pd.read_excel(LABEL_LEXICON_PATH, header=None)
    df = df.iloc[1:].reset_index(drop=True)

    LABEL_NORMALIZE = {
        "modality": "modality",
        "region": "region",
        "angiography": "angiography",
        "contrast": "contrast",
        "laterality": "laterality",
        "rvu_modifier": "rvu_modifier",
        "qualifier": "qualifier",
    }

    entries = []
    skipped = 0
    for _, row in df.iterrows():
        term = row.iloc[0]
        label = row.iloc[1] if len(row) > 1 else ""

        if pd.isna(term) or str(term).strip() == "":
            skipped += 1
            continue

        term = str(term).strip()

        if pd.isna(label) or str(label).strip() == "":
            skipped += 1
            continue

        label = str(label).strip().lower()

        if label in LABEL_NORMALIZE:
            entries.append({"term": term, "label": LABEL_NORMALIZE[label]})
        else:
            print(f"  WARNING: Unknown label '{label}' for term '{term}', skipping")
            skipped += 1
            continue

    result = {
        "version": "1.0",
        "description": "Labeling lexicon for clinical element classification. Converted from 001_Labeling_Lexicon.xlsx.",
        "lastUpdated": TODAY,
        "totalEntries": len(entries),
        "entries": entries,
    }

    out_path = os.path.join(DATA_DIR, "labeling-lexicon.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"  OK: Wrote {len(entries)} entries to {out_path} (skipped {skipped})")
    return len(entries)


def convert_scoring_config():
    print(f"Reading scoring config from: {SCORING_CONFIG_PATH}")

    with open(SCORING_CONFIG_PATH, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    result = {
        "version": "1.0",
        "description": "Scoring configuration for NewVue study name mapping. Converted from scoring_config.yaml.",
        "lastUpdated": TODAY,
        **config,
    }

    out_path = os.path.join(DATA_DIR, "scoring-config.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"  OK: Wrote scoring config to {out_path}")


LABEL_ELEMENT_COLUMNS = {
    "modality":     ["Modality1", "Modality2", "Modality3"],
    "region":       ["Region1", "Region2", "Region3", "Region4", "Region5"],
    "angiography":  ["Angio1", "Angio2", "Angio3", "Angio4"],
    "contrast":     ["Contrast1", "Contrast2"],
    "laterality":   ["Laterality1", "Laterality2"],
    "rvu_modifier": ["RVUModifier1", "RVUModifier2", "RVUModifier3", "RVUModifier4", "RVUModifier5"],
    "qualifier":    ["Qualifier1", "Qualifier2", "Qualifier3", "Qualifier4", "Qualifier5"],
}

COUNT_COLUMNS = [
    "ModalityCount", "CanonicalRegionCount", "TotalRegionCount",
    "AngioCount", "ImportantCount", "AdditionalCount",
]


def convert_linkage_catalogue():
    print(f"Reading linkage labelled from: {LINKAGE_LABELED_PATH}")
    labeled_df = pd.read_excel(LINKAGE_LABELED_PATH)
    print(f"  Labeled shape: {labeled_df.shape}")

    print(f"Reading linkage raw from: {LINKAGE_RAW_PATH}")
    raw_df = pd.read_excel(LINKAGE_RAW_PATH)
    print(f"  Raw shape: {raw_df.shape}")

    enterprise_col = raw_df.columns[2]
    print(f"  Enterprise column name: '{enterprise_col}'")

    labeled_df.columns = [c.strip() for c in labeled_df.columns]
    raw_df.columns = [c.strip() for c in raw_df.columns]
    enterprise_col_clean = enterprise_col.strip()

    entries = []
    skipped = 0
    no_enterprise = 0

    for idx in range(len(labeled_df)):
        row = labeled_df.iloc[idx]

        raw_study = ""
        if "RawStudy" in labeled_df.columns:
            raw_study = row.get("RawStudy", "")
        else:
            raw_study = row.iloc[1] if len(row) > 1 else ""

        if pd.isna(raw_study) or str(raw_study).strip() == "":
            skipped += 1
            continue

        raw_study = str(raw_study).strip()

        normalized_study = ""
        if "NormalizedStudy" in labeled_df.columns:
            normalized_study = row.get("NormalizedStudy", "")
        else:
            normalized_study = row.iloc[2] if len(row) > 2 else ""
        normalized_study = "" if pd.isna(normalized_study) else str(normalized_study).strip()

        enterprise_name = ""
        if idx < len(raw_df):
            ent_val = raw_df.iloc[idx][enterprise_col_clean]
            if pd.notna(ent_val):
                enterprise_name = str(ent_val).strip()
            else:
                no_enterprise += 1
        else:
            no_enterprise += 1

        labels = {}
        for element, cols in LABEL_ELEMENT_COLUMNS.items():
            element_vals = []
            for col in cols:
                val = row.get(col, "")
                element_vals.append(str(val).strip() if pd.notna(val) and str(val).strip() else "")
            labels[element] = element_vals

        counts = {}
        for col in COUNT_COLUMNS:
            val = row.get(col, 0)
            counts[col] = int(val) if pd.notna(val) else 0

        entries.append({
            "rawStudy": raw_study,
            "normalizedStudy": normalized_study,
            "enterpriseName": enterprise_name,
            "labels": labels,
            "counts": counts,
        })

    result = {
        "version": "1.0",
        "description": "Linkage catalogue with enterprise names. Joined from NewVue_Linkage_Labeled.xlsx and NewVue_Linkage_Raw.xlsx.",
        "lastUpdated": TODAY,
        "totalEntries": len(entries),
        "entries": entries,
    }

    out_path = os.path.join(DATA_DIR, "linkage-catalogue.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"  OK: Wrote {len(entries)} entries to {out_path} (skipped {skipped}, no enterprise: {no_enterprise})")
    return len(entries)


def main():
    print("=" * 60)
    print("Excel/YAML -> JSON Conversion for migration/data/")
    print("=" * 60)

    ensure_output_dir()

    norm_count = convert_normalization_lexicon()
    label_count = convert_labeling_lexicon()
    convert_scoring_config()
    catalogue_count = convert_linkage_catalogue()

    print()
    print("=" * 60)
    print(f"Done! Normalization: {norm_count}, Labeling: {label_count}, Catalogue: {catalogue_count}")
    print("=" * 60)


if __name__ == "__main__":
    main()
