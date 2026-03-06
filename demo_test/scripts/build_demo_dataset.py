#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'demos.csv'
OUTPUT_DIR = ROOT / 'webapp' / 'data'
ROWS_PATH = OUTPUT_DIR / 'demos_compact.json'
META_PATH = OUTPUT_DIR / 'meta.json'

METRIC_KEYS = [
    'pop',
    'hh',
    'ma',
    'mhi',
    'mhv',
    'dens',
    'his',
    'wht',
    'blk',
    'asn',
    'child',
    'young',
    'mid',
    'age55',
    'sen',
    'col',
    'adv',
    'own',
    'rent',
    'hiinc',
    'lowinc',
    'unemp',
    'wc',
    'povfam',
]

def number(raw: Optional[str]) -> float:
    if raw is None:
        return 0.0
    text = raw.strip().replace(',', '')
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


class PercentileStats:
    def __init__(self) -> None:
        self.values: List[float] = []

    def add(self, value: Optional[float]) -> None:
        if value is None or math.isnan(value):
            return
        self.values.append(value)

    def summary(self) -> Optional[Dict[str, float]]:
        if not self.values:
            return None
        values = sorted(self.values)
        return {
            'min': round(values[0], 4),
            'max': round(values[-1], 4),
            'p05': round(pick_quantile(values, 0.05), 4),
            'p50': round(median(values), 4),
            'p95': round(pick_quantile(values, 0.95), 4),
        }



def pick_quantile(values: List[float], q: float) -> float:
    if not values:
        return 0.0
    idx = max(0, min(len(values) - 1, int(round((len(values) - 1) * q))))
    return values[idx]



def pad_zip(raw_zip: str) -> str:
    digits = ''.join(ch for ch in raw_zip if ch.isdigit())
    if not digits:
        return raw_zip.strip()
    return digits.zfill(5)



def clean_label(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    value = raw.strip()
    if not value:
        return None
    return value



def percent(part: float, whole: float) -> Optional[float]:
    if whole <= 0:
        return None
    return round((part / whole) * 100.0, 2)



def maybe_value(value: float, *, zero_is_null: bool = False) -> Optional[float]:
    if zero_is_null and value <= 0:
        return None
    return round(value, 2)



def build_row(row: Dict[str, str]) -> Dict[str, object]:
    pop = number(row['Current Year Population'])
    hh = number(row['Current Year Households'])
    owner = number(row['Current Year Housing Units, Owner-Occupied'])
    renter = number(row['Current Year Housing Units, Renter-Occupied'])
    occupied = owner + renter
    families_above = number(row['Current Year Families At or Above Poverty'])
    families_below = number(row['Current Year Families Below Poverty'])
    labor_employed = number(row['Current Year Population 16+, Civilian Labor Force, Employed'])
    labor_unemployed = number(row['Current Year Population 16+, Civilian Labor Force, Unemployed'])
    white_collar = number(row['Current Year Employed Civilian Population 16+, Occupation Type: White Collar'])
    blue_collar = number(row['Current Year Employed Civilian Population 16+, Occupation Type: Blue Collar'])
    service_farming = number(row['Current Year Employed Civilian Population 16+, Occupation Type: Service and Farming'])
    occupation_total = white_collar + blue_collar + service_farming
    land_area = number(row['Land Area in Square Miles'])

    age_children = (
        number(row['Current Year Population, Age 0 - 4'])
        + number(row['Current Year Population, Age 5 - 9'])
        + number(row['Current Year Population, Age 10 - 14'])
        + number(row['Current Year Population, Age 15 - 17'])
    )
    age_young = (
        number(row['Current Year Population, Age 18 - 20'])
        + number(row['Current Year Population, Age 21 - 24'])
        + number(row['Current Year Population, Age 25 - 34'])
    )
    age_mid = number(row['Current Year Population, Age 35 - 44']) + number(row['Current Year Population, Age 45 - 54'])
    age_55_plus = number(row['Current Year Population, Age 55 - 64']) + number(row['Current Year Population, Age 65+'])
    age_seniors = number(row['Current Year Population, Age 65+'])

    education_fields = [
        'Current Year Population 25+, Less than 9th Grade',
        'Current Year Population 25+, Some High School, No Diploma',
        'Current Year Population 25+, High School Graduate (Including Equivalent)',
        'Current Year Population 25+, Some College, No Degree',
        "Current Year Population 25+, Associate's Degree",
        "Current Year Population 25+, Bachelor's Degree",
        "Current Year Population 25+, Master's Degree",
        'Current Year Population 25+, Professional Degree',
        'Current Year Population 25+, Doctorate Degree',
    ]
    education_total = sum(number(row[field]) for field in education_fields)
    college_plus = (
        number(row["Current Year Population 25+, Bachelor's Degree"])
        + number(row["Current Year Population 25+, Master's Degree"])
        + number(row['Current Year Population 25+, Professional Degree'])
        + number(row['Current Year Population 25+, Doctorate Degree'])
    )
    advanced_degree = (
        number(row["Current Year Population 25+, Master's Degree"])
        + number(row['Current Year Population 25+, Professional Degree'])
        + number(row['Current Year Population 25+, Doctorate Degree'])
    )

    low_income = (
        number(row['Current Year Households, Household Income < $15,000'])
        + number(row['Current Year Households, Household Income $15,000 - $24,999'])
        + number(row['Current Year Households, Household Income $25,000 - $34,999'])
        + number(row['Current Year Households, Household Income $35,000 - $49,999'])
    )
    high_income = (
        number(row['Current Year Households, Household Income $150,000 - $199,999'])
        + number(row['Current Year Households, Household Income $200,000 - $249,999'])
        + number(row['Current Year Households, Household Income $250,000 - $499,999'])
        + number(row['Current Year Households, Household Income $500,000+'])
    )

    median_income = number(row['Current Year Median Household Income'])
    median_home_value = number(row['Current Year Median Value, Owner-Occupied Housing Units'])
    median_age = number(row['Current Year Median Age'])

    compact = {
        'z': pad_zip(row['ZipCode']),
        'nm': clean_label(row.get('Geography Name')),
        'st': clean_label(row.get('State Name')),
        'cty': clean_label(row.get('County Name')),
        'msa': clean_label(row.get('Core Based Statistical Area Name')),
        'lat': round(number(row['Latitude']), 6),
        'lng': round(number(row['Longitude']), 6),
        'pop': int(round(pop)),
        'hh': int(round(hh)),
        'ma': maybe_value(median_age, zero_is_null=pop <= 0),
        'mhi': maybe_value(median_income, zero_is_null=hh <= 0),
        'mhv': maybe_value(median_home_value, zero_is_null=owner <= 0),
        'dens': maybe_value(pop / land_area, zero_is_null=land_area <= 0 or pop <= 0),
        'his': percent(number(row['Current Year Population, Hispanic/Latino']), pop),
        'wht': percent(number(row['Current Year Population, White Alone']), pop),
        'blk': percent(number(row['Current Year Population, Black/African American Alone']), pop),
        'asn': percent(number(row['Current Year Population, Asian Alone']), pop),
        'child': percent(age_children, pop),
        'young': percent(age_young, pop),
        'mid': percent(age_mid, pop),
        'age55': percent(age_55_plus, pop),
        'sen': percent(age_seniors, pop),
        'col': percent(college_plus, education_total),
        'adv': percent(advanced_degree, education_total),
        'own': percent(owner, occupied),
        'rent': percent(renter, occupied),
        'hiinc': percent(high_income, hh),
        'lowinc': percent(low_income, hh),
        'unemp': percent(labor_unemployed, labor_employed + labor_unemployed),
        'wc': percent(white_collar, occupation_total),
        'povfam': percent(families_below, families_above + families_below),
    }

    return compact



def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f'Missing source CSV: {SOURCE}')

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    rows: List[Dict[str, object]] = []
    metric_stats = {key: PercentileStats() for key in METRIC_KEYS}
    states: Dict[str, Dict[str, set[str]]] = {}

    with SOURCE.open('r', encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        for source_row in reader:
            compact = build_row(source_row)
            rows.append(compact)

            state = compact['st'] or 'Unknown'
            state_bucket = states.setdefault(state, {'counties': set(), 'msas': set()})
            if compact['cty']:
                state_bucket['counties'].add(compact['cty'])
            if compact['msa']:
                state_bucket['msas'].add(compact['msa'])

            for key in METRIC_KEYS:
                metric_stats[key].add(compact.get(key))

    rows.sort(key=lambda item: (item['st'] or '', item['cty'] or '', item['z']))

    global_counties = sorted({row['cty'] for row in rows if row.get('cty')})
    global_msas = sorted({row['msa'] for row in rows if row.get('msa')})
    zero_population = sum(1 for row in rows if int(row['pop']) <= 0)

    metrics_meta = {key: metric_stats[key].summary() for key in METRIC_KEYS}

    meta = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'sourceCsv': SOURCE.name,
        'rowCount': len(rows),
        'zeroPopulationRows': zero_population,
        'states': sorted(states.keys()),
        'counties': global_counties,
        'msas': global_msas,
        'statesMeta': {
            state: {
                'counties': sorted(values['counties']),
                'msas': sorted(values['msas']),
            }
            for state, values in sorted(states.items())
        },
        'metrics': metrics_meta,
    }

    with ROWS_PATH.open('w', encoding='utf-8') as handle:
        json.dump(rows, handle, separators=(',', ':'))

    with META_PATH.open('w', encoding='utf-8') as handle:
        json.dump(meta, handle, separators=(',', ':'))

    print(f'Wrote {ROWS_PATH.relative_to(ROOT)} ({len(rows)} rows)')
    print(f'Wrote {META_PATH.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
