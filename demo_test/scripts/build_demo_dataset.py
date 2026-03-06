#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'demos.csv'
OUTPUT_DIR = ROOT / 'webapp' / 'data'
ROWS_PATH = OUTPUT_DIR / 'demos_compact.json'
ROLLUPS_PATH = OUTPUT_DIR / 'demos_rollups.json'
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

AGE_FIELDS = [
    'Current Year Population, Age 0 - 4',
    'Current Year Population, Age 5 - 9',
    'Current Year Population, Age 10 - 14',
    'Current Year Population, Age 15 - 17',
    'Current Year Population, Age 18 - 20',
    'Current Year Population, Age 21 - 24',
    'Current Year Population, Age 25 - 34',
    'Current Year Population, Age 35 - 44',
    'Current Year Population, Age 45 - 54',
    'Current Year Population, Age 55 - 64',
    'Current Year Population, Age 65 - 74',
    'Current Year Population, Age 75 - 84',
    'Current Year Population, Age 85+',
]
AGE_BINS: List[Tuple[float, float]] = [
    (0, 5),
    (5, 10),
    (10, 15),
    (15, 18),
    (18, 21),
    (21, 25),
    (25, 35),
    (35, 45),
    (45, 55),
    (55, 65),
    (65, 75),
    (75, 85),
    (85, 95),
]

INCOME_FIELDS = [
    'Current Year Households, Household Income < $15,000',
    'Current Year Households, Household Income $15,000 - $24,999',
    'Current Year Households, Household Income $25,000 - $34,999',
    'Current Year Households, Household Income $35,000 - $49,999',
    'Current Year Households, Household Income $50,000 - $74,999',
    'Current Year Households, Household Income $75,000 - $99,999',
    'Current Year Households, Household Income $100,000 - $124,999',
    'Current Year Households, Household Income $125,000 - $149,999',
    'Current Year Households, Household Income $150,000 - $199,999',
    'Current Year Households, Household Income $200,000 - $249,999',
    'Current Year Households, Household Income $250,000 - $499,999',
    'Current Year Households, Household Income $500,000+',
]
INCOME_BINS: List[Tuple[float, float]] = [
    (0, 15_000),
    (15_000, 25_000),
    (25_000, 35_000),
    (35_000, 50_000),
    (50_000, 75_000),
    (75_000, 100_000),
    (100_000, 125_000),
    (125_000, 150_000),
    (150_000, 200_000),
    (200_000, 250_000),
    (250_000, 500_000),
    (500_000, 650_000),
]

VALUE_FIELDS = [
    'Current Year Owner-Occupied Housing Units, Value < $20,000',
    'Current Year Owner-Occupied Housing Units, Value $20,000 - $39,999',
    'Current Year Owner-Occupied Housing Units, Value $40,000 - $59,999',
    'Current Year Owner-Occupied Housing Units, Value $60,000 - $79,999',
    'Current Year Owner-Occupied Housing Units, Value $80,000 - $99,999',
    'Current Year Owner-Occupied Housing Units, Value $100,000 - $149,999',
    'Current Year Owner-Occupied Housing Units, Value $150,000 - $199,999',
    'Current Year Owner-Occupied Housing Units, Value $200,000 - $299,999',
    'Current Year Owner-Occupied Housing Units, Value $300,000 - $399,999',
    'Current Year Owner-Occupied Housing Units, Value $400,000 - $499,999',
    'Current Year Owner-Occupied Housing Units, Value $500,000 - $749,999',
    'Current Year Owner-Occupied Housing Units, Value $750,000 - $999,999',
    'Current Year Owner-Occupied Housing Units, Value $1,000,000 - $1,499,999',
    'Current Year Owner-Occupied Housing Units, Value $1,500,000 - $1,999,999',
    'Current Year Owner-Occupied Housing Units, Value $2,000,000+',
]
VALUE_BINS: List[Tuple[float, float]] = [
    (0, 20_000),
    (20_000, 40_000),
    (40_000, 60_000),
    (60_000, 80_000),
    (80_000, 100_000),
    (100_000, 150_000),
    (150_000, 200_000),
    (200_000, 300_000),
    (300_000, 400_000),
    (400_000, 500_000),
    (500_000, 750_000),
    (750_000, 1_000_000),
    (1_000_000, 1_500_000),
    (1_500_000, 2_000_000),
    (2_000_000, 2_400_000),
]

EDUCATION_FIELDS = [
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

MSA_CODE_FIELD = 'Metropolitan Statistical Area or New England County Metro Area (MSA/NECMA) Code'


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



def pick_quantile(values: Sequence[float], q: float) -> float:
    if not values:
        return 0.0
    idx = max(0, min(len(values) - 1, int(round((len(values) - 1) * q))))
    return values[idx]



def pad_zip(raw_zip: str) -> str:
    digits = ''.join(ch for ch in raw_zip if ch.isdigit())
    if not digits:
        return raw_zip.strip()
    return digits.zfill(5)



def clean_code(raw: Optional[str], width: Optional[int] = None) -> Optional[str]:
    if raw is None:
        return None
    digits = ''.join(ch for ch in raw if ch.isdigit())
    if not digits:
        return None
    if width is not None:
        return digits.zfill(width)
    return digits



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



def maybe_value(value: Optional[float], *, zero_is_null: bool = False, digits: int = 2) -> Optional[float]:
    if value is None or math.isnan(value):
        return None
    if zero_is_null and value <= 0:
        return None
    return round(value, digits)



def estimate_median_from_bins(counts: Sequence[float], bins: Sequence[Tuple[float, float]]) -> Optional[float]:
    total = sum(counts)
    if total <= 0:
        return None

    midpoint = total / 2.0
    cumulative = 0.0
    for count, (lower, upper) in zip(counts, bins):
        next_total = cumulative + count
        if next_total >= midpoint:
            if count <= 0:
                return (lower + upper) / 2.0
            fraction = (midpoint - cumulative) / count
            return lower + fraction * (upper - lower)
        cumulative = next_total

    return bins[-1][1]



def stats_for_rows(rows: Iterable[Dict[str, object]]) -> Dict[str, Optional[Dict[str, float]]]:
    buckets = {key: PercentileStats() for key in METRIC_KEYS}
    for row in rows:
        for key in METRIC_KEYS:
            buckets[key].add(row.get(key))
    return {key: buckets[key].summary() for key in METRIC_KEYS}



def build_base_record(row: Dict[str, str]) -> Dict[str, object]:
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

    age_hist = [number(row[field]) for field in AGE_FIELDS]
    age_children = sum(age_hist[:4])
    age_young = sum(age_hist[4:7])
    age_mid = sum(age_hist[7:9])
    age_55_plus = sum(age_hist[9:])
    age_seniors = sum(age_hist[10:])

    education_total = sum(number(row[field]) for field in EDUCATION_FIELDS)
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

    income_hist = [number(row[field]) for field in INCOME_FIELDS]
    low_income = sum(income_hist[:4])
    high_income = sum(income_hist[8:])

    value_hist = [number(row[field]) for field in VALUE_FIELDS]

    state_code = clean_code(row.get('FIPS State Code'), 2)
    county_code = clean_code(row.get('FIPS County Code'), 3)
    county_key = None
    if state_code and county_code:
        county_key = f'{state_code}{county_code}'
    elif clean_label(row.get('State Name')) and clean_label(row.get('County Name')):
        county_key = f"{clean_label(row.get('State Name'))}||{clean_label(row.get('County Name'))}"

    msa_name = clean_label(row.get('Core Based Statistical Area Name'))
    msa_code = clean_code(row.get(MSA_CODE_FIELD))
    msa_key = msa_code or msa_name

    return {
        'id': pad_zip(row['ZipCode']),
        'z': pad_zip(row['ZipCode']),
        'nm': clean_label(row.get('Geography Name')),
        'st': clean_label(row.get('State Name')),
        'cty': clean_label(row.get('County Name')),
        'msa': msa_name,
        'ck': county_key,
        'mc': msa_key,
        'lat': round(number(row['Latitude']), 6),
        'lng': round(number(row['Longitude']), 6),
        'pop': int(round(pop)),
        'hh': int(round(hh)),
        'land_area': land_area,
        'race_his': number(row['Current Year Population, Hispanic/Latino']),
        'race_wht': number(row['Current Year Population, White Alone']),
        'race_blk': number(row['Current Year Population, Black/African American Alone']),
        'race_asn': number(row['Current Year Population, Asian Alone']),
        'age_hist': age_hist,
        'age_children': age_children,
        'age_young': age_young,
        'age_mid': age_mid,
        'age_55_plus': age_55_plus,
        'age_seniors': age_seniors,
        'education_total': education_total,
        'college_plus': college_plus,
        'advanced_degree': advanced_degree,
        'owner': owner,
        'renter': renter,
        'occupied': occupied,
        'income_hist': income_hist,
        'high_income': high_income,
        'low_income': low_income,
        'value_hist': value_hist,
        'families_above': families_above,
        'families_below': families_below,
        'labor_employed': labor_employed,
        'labor_unemployed': labor_unemployed,
        'white_collar': white_collar,
        'occupation_total': occupation_total,
        'exact_ma': number(row['Current Year Median Age']),
        'exact_mhi': number(row['Current Year Median Household Income']),
        'exact_mhv': number(row['Current Year Median Value, Owner-Occupied Housing Units']),
    }



def compute_metrics(totals: Dict[str, object], *, use_exact_medians: bool = False) -> Dict[str, object]:
    pop = float(totals['pop'])
    hh = float(totals['hh'])
    owner = float(totals['owner'])
    occupied = float(totals['occupied'])
    labor_force = float(totals['labor_employed']) + float(totals['labor_unemployed'])
    family_total = float(totals['families_above']) + float(totals['families_below'])
    land_area = float(totals['land_area'])

    median_age = float(totals['exact_ma']) if use_exact_medians else estimate_median_from_bins(totals['age_hist'], AGE_BINS)
    median_income = float(totals['exact_mhi']) if use_exact_medians else estimate_median_from_bins(totals['income_hist'], INCOME_BINS)
    median_home_value = float(totals['exact_mhv']) if use_exact_medians else estimate_median_from_bins(totals['value_hist'], VALUE_BINS)

    return {
        'pop': int(round(pop)),
        'hh': int(round(hh)),
        'ma': maybe_value(median_age, zero_is_null=pop <= 0, digits=1),
        'mhi': maybe_value(median_income, zero_is_null=hh <= 0, digits=2),
        'mhv': maybe_value(median_home_value, zero_is_null=owner <= 0, digits=2),
        'dens': maybe_value(pop / land_area if land_area > 0 else None, zero_is_null=land_area <= 0 or pop <= 0, digits=2),
        'his': percent(float(totals['race_his']), pop),
        'wht': percent(float(totals['race_wht']), pop),
        'blk': percent(float(totals['race_blk']), pop),
        'asn': percent(float(totals['race_asn']), pop),
        'child': percent(float(totals['age_children']), pop),
        'young': percent(float(totals['age_young']), pop),
        'mid': percent(float(totals['age_mid']), pop),
        'age55': percent(float(totals['age_55_plus']), pop),
        'sen': percent(float(totals['age_seniors']), pop),
        'col': percent(float(totals['college_plus']), float(totals['education_total'])),
        'adv': percent(float(totals['advanced_degree']), float(totals['education_total'])),
        'own': percent(float(totals['owner']), occupied),
        'rent': percent(float(totals['renter']), occupied),
        'hiinc': percent(float(totals['high_income']), hh),
        'lowinc': percent(float(totals['low_income']), hh),
        'unemp': percent(float(totals['labor_unemployed']), labor_force),
        'wc': percent(float(totals['white_collar']), float(totals['occupation_total'])),
        'povfam': percent(float(totals['families_below']), family_total),
    }



def build_zip_row(base: Dict[str, object]) -> Dict[str, object]:
    row = {
        'id': base['id'],
        'z': base['z'],
        'nm': base['nm'],
        'st': base['st'],
        'cty': base['cty'],
        'msa': base['msa'],
        'ck': base['ck'],
        'mc': base['mc'],
        'lat': base['lat'],
        'lng': base['lng'],
    }
    row.update(compute_metrics(base, use_exact_medians=True))
    return row



def empty_bucket(group_id: str, granularity: str, sample: Dict[str, object]) -> Dict[str, object]:
    label = ''
    if granularity == 'county':
        label = str(sample['cty'] or 'Unknown County')
    elif granularity == 'msa':
        label = str(sample['msa'] or 'Unknown MSA')
    else:
        label = str(sample['st'] or 'Unknown State')

    return {
        'id': group_id,
        'granularity': granularity,
        'label': label,
        'st': sample['st'] if granularity == 'county' else None,
        'cty': sample['cty'] if granularity == 'county' else None,
        'msa': sample['msa'] if granularity == 'msa' else None,
        'ck': sample['ck'] if granularity == 'county' else None,
        'mc': sample['mc'] if granularity == 'msa' else None,
        'pop': 0.0,
        'hh': 0.0,
        'land_area': 0.0,
        'race_his': 0.0,
        'race_wht': 0.0,
        'race_blk': 0.0,
        'race_asn': 0.0,
        'age_hist': [0.0] * len(AGE_FIELDS),
        'age_children': 0.0,
        'age_young': 0.0,
        'age_mid': 0.0,
        'age_55_plus': 0.0,
        'age_seniors': 0.0,
        'education_total': 0.0,
        'college_plus': 0.0,
        'advanced_degree': 0.0,
        'owner': 0.0,
        'renter': 0.0,
        'occupied': 0.0,
        'income_hist': [0.0] * len(INCOME_FIELDS),
        'high_income': 0.0,
        'low_income': 0.0,
        'value_hist': [0.0] * len(VALUE_FIELDS),
        'families_above': 0.0,
        'families_below': 0.0,
        'labor_employed': 0.0,
        'labor_unemployed': 0.0,
        'white_collar': 0.0,
        'occupation_total': 0.0,
        '_lat_num': 0.0,
        '_lng_num': 0.0,
        '_coord_weight': 0.0,
        '_zip_count': 0,
        '_states': set(),
    }



def roll_histogram(target: List[float], source: Sequence[float]) -> None:
    for index, value in enumerate(source):
        target[index] += value



def consume_bucket(bucket: Dict[str, object], base: Dict[str, object]) -> None:
    for key in (
        'pop',
        'hh',
        'land_area',
        'race_his',
        'race_wht',
        'race_blk',
        'race_asn',
        'age_children',
        'age_young',
        'age_mid',
        'age_55_plus',
        'age_seniors',
        'education_total',
        'college_plus',
        'advanced_degree',
        'owner',
        'renter',
        'occupied',
        'high_income',
        'low_income',
        'families_above',
        'families_below',
        'labor_employed',
        'labor_unemployed',
        'white_collar',
        'occupation_total',
    ):
        bucket[key] += float(base[key])

    roll_histogram(bucket['age_hist'], base['age_hist'])
    roll_histogram(bucket['income_hist'], base['income_hist'])
    roll_histogram(bucket['value_hist'], base['value_hist'])

    lat = base['lat']
    lng = base['lng']
    coord_weight = max(float(base['pop']), float(base['hh']), 1.0)
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and math.isfinite(lat) and math.isfinite(lng):
        bucket['_lat_num'] += float(lat) * coord_weight
        bucket['_lng_num'] += float(lng) * coord_weight
        bucket['_coord_weight'] += coord_weight

    bucket['_zip_count'] += 1
    if base['st']:
        bucket['_states'].add(str(base['st']))



def finalize_bucket(bucket: Dict[str, object]) -> Dict[str, object]:
    metrics = compute_metrics(bucket)
    lat = None
    lng = None
    if bucket['_coord_weight'] > 0:
        lat = round(bucket['_lat_num'] / bucket['_coord_weight'], 6)
        lng = round(bucket['_lng_num'] / bucket['_coord_weight'], 6)

    states = sorted(bucket['_states'])
    row = {
        'id': bucket['id'],
        'z': bucket['label'],
        'nm': bucket['label'],
        'st': bucket['st'],
        'cty': bucket['cty'],
        'msa': bucket['msa'],
        'ck': bucket['ck'],
        'mc': bucket['mc'],
        'lat': lat,
        'lng': lng,
        '_zipCount': bucket['_zip_count'],
    }
    row.update(metrics)

    if bucket['granularity'] == 'msa':
        row['sts'] = states
        row['stc'] = len(states)
        if len(states) == 1:
            row['st'] = states[0]
    elif states and not row['st']:
        row['st'] = states[0]

    return row



def build_rollups(base_rows: Sequence[Dict[str, object]], granularity: str) -> List[Dict[str, object]]:
    buckets: Dict[str, Dict[str, object]] = {}
    for base in base_rows:
        if granularity == 'county':
            key = base['ck']
        elif granularity == 'msa':
            key = base['mc']
        else:
            key = base['st']

        if not key:
            continue

        key_str = str(key)
        bucket = buckets.get(key_str)
        if bucket is None:
            bucket = empty_bucket(key_str, granularity, base)
            buckets[key_str] = bucket
        consume_bucket(bucket, base)

    rows = [finalize_bucket(bucket) for bucket in buckets.values()]
    if granularity == 'county':
        rows.sort(key=lambda item: ((item.get('st') or ''), (item.get('cty') or ''), item['id']))
    elif granularity == 'msa':
        rows.sort(key=lambda item: ((item.get('msa') or item.get('z') or ''), item['id']))
    else:
        rows.sort(key=lambda item: ((item.get('st') or item.get('z') or ''), item['id']))
    return rows



def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f'Missing source CSV: {SOURCE}')

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    base_rows: List[Dict[str, object]] = []
    zip_rows: List[Dict[str, object]] = []

    with SOURCE.open('r', encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        for source_row in reader:
            base = build_base_record(source_row)
            base_rows.append(base)
            zip_rows.append(build_zip_row(base))

    zip_rows.sort(key=lambda item: ((item.get('st') or ''), (item.get('cty') or ''), item['z']))

    county_rows = build_rollups(base_rows, 'county')
    msa_rows = build_rollups(base_rows, 'msa')
    state_rows = build_rollups(base_rows, 'state')

    datasets = {
        'zip': zip_rows,
        'county': county_rows,
        'msa': msa_rows,
        'state': state_rows,
    }

    meta = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'sourceCsv': SOURCE.name,
        'zeroPopulationRows': sum(1 for row in zip_rows if int(row['pop']) <= 0),
        'datasets': {
            key: {
                'rowCount': len(rows),
                'metrics': stats_for_rows(rows),
            }
            for key, rows in datasets.items()
        },
    }

    with ROWS_PATH.open('w', encoding='utf-8') as handle:
        json.dump(zip_rows, handle, separators=(',', ':'))

    with ROLLUPS_PATH.open('w', encoding='utf-8') as handle:
        json.dump({'county': county_rows, 'msa': msa_rows, 'state': state_rows}, handle, separators=(',', ':'))

    with META_PATH.open('w', encoding='utf-8') as handle:
        json.dump(meta, handle, separators=(',', ':'))

    print(f'Wrote {ROWS_PATH.relative_to(ROOT)} ({len(zip_rows)} rows)')
    print(f'Wrote {ROLLUPS_PATH.relative_to(ROOT)} (county={len(county_rows)}, msa={len(msa_rows)}, state={len(state_rows)})')
    print(f'Wrote {META_PATH.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
