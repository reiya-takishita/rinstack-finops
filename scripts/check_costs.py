#!/usr/bin/env python3
"""CSVファイルのコストを確認するスクリプト"""

import csv
from pathlib import Path

files = ['Oct2018-WorkshopCUR-00001.csv', 'Nov2018-WorkshopCUR-00001.csv', 'Dec2018-WorkshopCUR-00001.csv']
mock_dir = Path('docs/s3_mock')

print('各月のサービス別コスト（5000以上）:')
print('=' * 60)

for filename in files:
    filepath = mock_dir / filename
    if not filepath.exists():
        print(f'\n{filename}: ファイルが見つかりません')
        continue
    
    print(f'\n{filename}:')
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        
        cost_idx = header.index('line_item_unblended_cost')
        product_idx = header.index('product_product_name')
        
        costs = {}
        for row in reader:
            if len(row) > max(cost_idx, product_idx):
                product_name = row[product_idx].strip('"')
                cost = float(row[cost_idx] or 0)
                costs[product_name] = costs.get(product_name, 0) + cost
        
        # 5000以上のサービスを表示
        high_cost_services = [(k, v) for k, v in sorted(costs.items(), key=lambda x: -x[1]) if v >= 5000]
        for service, cost in high_cost_services[:10]:
            print(f'  {service}: {cost:.2f}')

