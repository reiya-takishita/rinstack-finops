#!/usr/bin/env python3
"""
月ごとにランダムで10サービスに5000以上のコストを追加するスクリプト
"""

import csv
import sys
import random
import os
from pathlib import Path
from collections import defaultdict

def add_random_service_costs(input_file: str, output_file: str, num_services: int = 10, min_cost: float = 5000.0):
    """
    CURファイルのランダムなサービスにコストを追加
    
    Args:
        input_file: 入力ファイルパス
        output_file: 出力ファイルパス
        num_services: 追加するサービス数（デフォルト: 10）
        min_cost: 追加する最小コスト（デフォルト: 5000.0）
    """
    cost_column = 'line_item_unblended_cost'
    product_column = 'product_product_name'
    
    # サービスごとの行インデックスを記録
    service_rows: dict[str, list[int]] = defaultdict(list)
    all_rows = []
    
    with open(input_file, 'r', encoding='utf-8') as infile:
        reader = csv.reader(infile)
        
        # ヘッダー行を読み込み
        header = next(reader)
        all_rows.append(header)
        
        # カラムインデックスを取得
        try:
            cost_idx = header.index(cost_column)
            product_idx = header.index(product_column)
        except ValueError as e:
            print(f"エラー: 必要なカラムが見つかりません: {e}", file=sys.stderr)
            sys.exit(1)
        
        # データ行を読み込み、サービスごとに分類
        row_num = 1  # ヘッダーを除く
        for row in reader:
            all_rows.append(row)
            if len(row) > max(cost_idx, product_idx):
                product_name = row[product_idx].strip('"')
                if product_name:  # 空でないサービス名のみ
                    service_rows[product_name].append(row_num)
            row_num += 1
    
    # コストが0より大きいサービスをフィルタリング（実際に使用されているサービス）
    services_with_cost = {
        service: rows 
        for service, rows in service_rows.items() 
        if any(float(all_rows[idx][cost_idx] or 0) > 0 for idx in rows)
    }
    
    if len(services_with_cost) == 0:
        print(f"警告: コストがあるサービスが見つかりません: {input_file}", file=sys.stderr)
        return
    
    # ランダムにサービスを選択
    selected_services = random.sample(
        list(services_with_cost.keys()), 
        min(num_services, len(services_with_cost))
    )
    
    print(f"選択されたサービス ({len(selected_services)}個):")
    for service in selected_services:
        print(f"  - {service}")
    
    # 選択されたサービスに対してコストを追加
    modified_count = 0
    for service in selected_services:
        # そのサービスの行からランダムに1つ選択
        service_row_indices = services_with_cost[service]
        if not service_row_indices:
            continue
        
        # ランダムに1行を選択してコストを追加
        target_row_idx = random.choice(service_row_indices)
        target_row = all_rows[target_row_idx]
        
        # 既存のコストを取得
        try:
            existing_cost = float(target_row[cost_idx] or 0)
            # 5000以上、10000以下のランダムなコストを追加
            additional_cost = random.uniform(min_cost, min_cost * 2)
            new_cost = existing_cost + additional_cost
            target_row[cost_idx] = str(new_cost)
            modified_count += 1
            print(f"  {service}: {existing_cost:.2f} -> {new_cost:.2f} (+{additional_cost:.2f})")
        except (ValueError, IndexError) as e:
            print(f"警告: 行 {target_row_idx} のコスト更新に失敗: {e}", file=sys.stderr)
            continue
    
    # 結果を書き込み
    with open(output_file, 'w', encoding='utf-8', newline='') as outfile:
        writer = csv.writer(outfile)
        for row in all_rows:
            writer.writerow(row)
    
    print(f"\n処理完了: {modified_count}個のサービスにコストを追加しました")
    print(f"入力: {input_file}")
    print(f"出力: {output_file}")

def main():
    if len(sys.argv) < 2:
        print("使用方法: python3 add_random_service_costs.py [サービス数] [最小コスト] [入力ファイル...]")
        print("例: python3 add_random_service_costs.py 10 5000 docs/s3_mock/*.csv")
        sys.exit(1)
    
    num_services = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    min_cost = float(sys.argv[2]) if len(sys.argv) > 2 else 5000.0
    input_files = sys.argv[3:] if len(sys.argv) > 3 else []
    
    # デフォルトのファイルパス
    script_dir = Path(__file__).parent
    mock_dir = script_dir.parent / 'docs' / 's3_mock'
    
    if not input_files:
        # デフォルトでs3_mockディレクトリ内のすべてのCSVファイルを処理
        input_files = list(mock_dir.glob('*.csv'))
        # バックアップファイルは除外
        input_files = [f for f in input_files if not f.name.endswith('.bak')]
    
    if not input_files:
        print("エラー: 処理するファイルが見つかりません", file=sys.stderr)
        sys.exit(1)
    
    # 月ごとにランダムシードを設定（再現性のため）
    random.seed(42)  # 固定シードで再現可能に
    
    for input_file in input_files:
        input_path = Path(input_file)
        if not input_path.exists():
            print(f"警告: ファイルが見つかりません: {input_file}", file=sys.stderr)
            continue
        
        print(f"\n処理中: {input_path.name}")
        print("=" * 60)
        
        # バックアップを作成（既に存在しない場合）
        backup_file = input_path.with_suffix('.csv.bak2')
        if not backup_file.exists() and not input_path.with_suffix('.csv.bak').exists():
            import shutil
            shutil.copy2(input_path, backup_file)
            print(f"バックアップ作成: {backup_file}")
        
        # 一時ファイルに書き込み
        temp_file = input_path.with_suffix('.csv.tmp')
        add_random_service_costs(str(input_path), str(temp_file), num_services, min_cost)
        
        # 元のファイルを置き換え
        temp_file.replace(input_path)
        print(f"更新完了: {input_path}\n")

if __name__ == '__main__':
    main()

