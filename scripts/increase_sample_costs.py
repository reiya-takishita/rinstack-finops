#!/usr/bin/env python3
"""
サンプルCURファイルのコスト値を増やすスクリプト
指定した倍率でコストを増やします（デフォルト: 10倍）
"""

import csv
import sys
import os
from pathlib import Path

def increase_costs(input_file: str, output_file: str, multiplier: float = 10.0):
    """
    CURファイルのコスト値を増やす
    
    Args:
        input_file: 入力ファイルパス
        output_file: 出力ファイルパス
        multiplier: コストの倍率（デフォルト: 10.0）
    """
    cost_column = 'line_item_unblended_cost'
    
    with open(input_file, 'r', encoding='utf-8') as infile, \
         open(output_file, 'w', encoding='utf-8', newline='') as outfile:
        
        reader = csv.reader(infile)
        writer = csv.writer(outfile)
        
        # ヘッダー行を読み込み
        header = next(reader)
        writer.writerow(header)
        
        # コストカラムのインデックスを取得
        try:
            cost_idx = header.index(cost_column)
        except ValueError:
            print(f"エラー: カラム '{cost_column}' が見つかりません", file=sys.stderr)
            sys.exit(1)
        
        # データ行を処理
        modified_count = 0
        for row in reader:
            if len(row) > cost_idx:
                try:
                    # コスト値を取得して倍率を掛ける
                    original_cost = float(row[cost_idx] or 0)
                    new_cost = original_cost * multiplier
                    row[cost_idx] = str(new_cost)
                    modified_count += 1
                except ValueError:
                    # 数値に変換できない場合はそのまま
                    pass
            
            writer.writerow(row)
        
        print(f"処理完了: {modified_count}行のコストを{multiplier}倍に増やしました")
        print(f"入力: {input_file}")
        print(f"出力: {output_file}")

def main():
    if len(sys.argv) < 2:
        print("使用方法: python3 increase_sample_costs.py <倍率> [入力ファイル...]")
        print("例: python3 increase_sample_costs.py 10 docs/s3_mock/*.csv")
        sys.exit(1)
    
    multiplier = float(sys.argv[1])
    input_files = sys.argv[2:] if len(sys.argv) > 2 else []
    
    # デフォルトのファイルパス
    script_dir = Path(__file__).parent
    mock_dir = script_dir.parent / 'docs' / 's3_mock'
    
    if not input_files:
        # デフォルトでs3_mockディレクトリ内のすべてのCSVファイルを処理
        input_files = list(mock_dir.glob('*.csv'))
    
    if not input_files:
        print("エラー: 処理するファイルが見つかりません", file=sys.stderr)
        sys.exit(1)
    
    for input_file in input_files:
        input_path = Path(input_file)
        if not input_path.exists():
            print(f"警告: ファイルが見つかりません: {input_file}", file=sys.stderr)
            continue
        
        # バックアップを作成
        backup_file = input_path.with_suffix('.csv.bak')
        if not backup_file.exists():
            import shutil
            shutil.copy2(input_path, backup_file)
            print(f"バックアップ作成: {backup_file}")
        
        # 一時ファイルに書き込み
        temp_file = input_path.with_suffix('.csv.tmp')
        increase_costs(str(input_path), str(temp_file), multiplier)
        
        # 元のファイルを置き換え
        temp_file.replace(input_path)
        print(f"更新完了: {input_path}\n")

if __name__ == '__main__':
    main()

