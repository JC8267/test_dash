#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'demos.csv'
ZIP_PATH = ROOT / 'webapp' / 'data' / 'demos_compact.json'
ROLLUPS_PATH = ROOT / 'webapp' / 'data' / 'demos_rollups.json'

PERCENT_KEYS = ['his', 'wht', 'blk', 'asn', 'child', 'young', 'mid', 'age55', 'sen', 'col', 'adv', 'own', 'rent', 'hiinc', 'lowinc', 'unemp', 'wc', 'povfam']


def load_json(path: Path):
    return json.loads(path.read_text())


def clean_code(raw: str | None, width: int | None = None) -> str | None:
    if raw is None:
        return None
    digits = ''.join(ch for ch in raw if ch.isdigit())
    if not digits:
        return None
    return digits.zfill(width) if width else digits


def main() -> None:
    zip_rows = load_json(ZIP_PATH)
    rollups = load_json(ROLLUPS_PATH)
    county_rows = rollups['county']
    msa_rows = rollups['msa']
    state_rows = rollups['state']

    assert len({row['id'] for row in county_rows}) == len(county_rows), 'County ids are not unique'
    assert len({row['id'] for row in msa_rows}) == len(msa_rows), 'MSA ids are not unique'
    assert len({row['id'] for row in state_rows}) == len(state_rows), 'State ids are not unique'

    duplicate_county_labels = sum(1 for count in Counter(row['z'] for row in county_rows).values() if count > 1)
    assert duplicate_county_labels > 0, 'Expected duplicate county labels across states to remain distinct by id'

    state_zip_pop = defaultdict(int)
    orange_ca_pop = 0
    with SOURCE.open('r', encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            state = (row.get('State Name') or '').strip()
            pop = int(round(float((row.get('Current Year Population') or '0').replace(',', '') or 0)))
            state_zip_pop[state] += pop
            state_code = clean_code(row.get('FIPS State Code'), 2)
            county_code = clean_code(row.get('FIPS County Code'), 3)
            if f'{state_code}{county_code}' == '06059':
                orange_ca_pop += pop

    state_lookup = {row['id']: row for row in state_rows}
    assert state_lookup['Texas']['pop'] == state_zip_pop['Texas'], 'Texas state pop rollup mismatch'
    assert state_lookup['California']['pop'] == state_zip_pop['California'], 'California state pop rollup mismatch'

    county_lookup = {row['id']: row for row in county_rows}
    assert county_lookup['06059']['pop'] == orange_ca_pop, 'Orange County, CA pop rollup mismatch'

    for dataset_name, rows in [('zip', zip_rows), ('county', county_rows), ('msa', msa_rows), ('state', state_rows)]:
        for row in rows:
            for key in PERCENT_KEYS:
                value = row.get(key)
                if value is None:
                    continue
                assert 0 <= value <= 100, f'{dataset_name} {row["id"]} has out-of-range {key}={value}'

    print(f'Validated rollups: zip={len(zip_rows)}, county={len(county_rows)}, msa={len(msa_rows)}, state={len(state_rows)}')
    print(f'Duplicate county labels safely separated by id: {duplicate_county_labels}')
    print(f'Texas pop: {state_lookup["Texas"]["pop"]:,}')
    print(f'Orange County, CA pop: {county_lookup["06059"]["pop"]:,}')


if __name__ == '__main__':
    main()
