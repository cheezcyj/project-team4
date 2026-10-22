"""Read selected columns from the prepared 2024 SAS datasets."""

from pathlib import Path

import pyreadstat


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "raw" / "knhanes" / "2024"


def main():
    health, health_meta = pyreadstat.read_sas7bdat(
        DATA / "hn24_all.sas7bdat",
        usecols=["ID", "year", "sex", "age", "HE_BMI", "HE_glu", "HE_HbA1c"],
    )
    print(f"Health: {health.shape[0]:,} rows x {health.shape[1]} selected columns")
    print(health.drop(columns="ID").head().to_string(index=False))
    print("Variable labels:", health_meta.column_names_to_labels)

    # Read only 100 rows initially; omit row_limit to read all food records.
    food, _ = pyreadstat.read_sas7bdat(
        DATA / "hn24_24rc.sas7bdat",
        usecols=["ID", "N_FCODE", "N_FNAME", "NF_INTK", "NF_CHO", "NF_SUGAR"],
        row_limit=100,
    )
    print(f"\nFood preview: {food.shape[0]} rows x {food.shape[1]} selected columns")
    print(food.drop(columns="ID").head().to_string(index=False))


if __name__ == "__main__":
    main()
