#!/usr/bin/env python3
"""
CURファイルからコストを算出するスクリプト

AWSの推奨に従い、line_item_net_unblended_costを優先的に使用し、
値がない場合のみline_item_unblended_costを使用します。
"""

import csv
import sys
import json
from pathlib import Path
from collections import defaultdict
from datetime import datetime
from typing import Optional


def parse_cost_value(value: str) -> float:
    """
    コスト値をパース（空文字、0、0.0などを0として扱う）
    
    Args:
        value: コスト値の文字列
        
    Returns:
        パースされたコスト値（float）
    """
    if not value or value.strip() == '':
        return 0.0
    
    # クォートを除去
    value = value.strip().strip('"').strip("'")
    
    if not value or value == '0' or value == '0.0':
        return 0.0
    
    try:
        return float(value)
    except ValueError:
        return 0.0


def get_cost(row: list[str], net_unblended_idx: Optional[int], unblended_idx: Optional[int]) -> float:
    """
    行からコストを取得（net_unblended_costを優先、なければunblended_cost）
    
    Args:
        row: CSV行データ
        net_unblended_idx: line_item_net_unblended_costのカラムインデックス
        unblended_idx: line_item_unblended_costのカラムインデックス
        
    Returns:
        コスト値
    """
    # net_unblended_costを優先的に使用
    if net_unblended_idx is not None and len(row) > net_unblended_idx:
        net_unblended_cost = parse_cost_value(row[net_unblended_idx])
        if net_unblended_cost > 0:
            return net_unblended_cost
    
    # net_unblended_costが使えない場合はunblended_costを使用
    if unblended_idx is not None and len(row) > unblended_idx:
        unblended_cost = parse_cost_value(row[unblended_idx])
        return unblended_cost
    
    return 0.0


def parse_product_name(product_str: str) -> str:
    """
    productカラム（JSON形式）からproduct_nameを抽出
    
    Args:
        product_str: productカラムの文字列（JSON形式）
        
    Returns:
        product_name（抽出できない場合は空文字）
    """
    if not product_str or product_str.strip() == '':
        return ''
    
    try:
        # クォートを除去してJSONパース
        product_str = product_str.strip().strip('"').strip("'")
        product_data = json.loads(product_str)
        return product_data.get('product_name', '')
    except (json.JSONDecodeError, AttributeError):
        return ''


def calculate_costs(input_file: str, group_by: str = 'all'):
    """
    CURファイルからコストを算出
    
    Args:
        input_file: 入力CSVファイルパス
        group_by: 集計方法 ('all', 'service', 'date', 'service_date')
    """
    net_unblended_cost_col = 'line_item_net_unblended_cost'
    unblended_cost_col = 'line_item_unblended_cost'
    usage_start_date_col = 'line_item_usage_start_date'
    product_col = 'product'
    product_code_col = 'line_item_product_code'
    
    # 集計用の辞書
    total_cost = 0.0
    service_costs: dict[str, float] = defaultdict(float)
    date_costs: dict[str, float] = defaultdict(float)
    service_date_costs: dict[tuple[str, str], float] = defaultdict(float)
    
    row_count = 0
    processed_count = 0
    
    try:
        with open(input_file, 'r', encoding='utf-8') as infile:
            reader = csv.reader(infile)
            
            # ヘッダー行を読み込み
            header = next(reader)
            
            # カラムインデックスを取得
            try:
                net_unblended_idx = header.index(net_unblended_cost_col) if net_unblended_cost_col in header else None
                unblended_idx = header.index(unblended_cost_col) if unblended_cost_col in header else None
                usage_start_date_idx = header.index(usage_start_date_col) if usage_start_date_col in header else None
                product_idx = header.index(product_col) if product_col in header else None
                product_code_idx = header.index(product_code_col) if product_code_col in header else None
            except ValueError as e:
                print(f"エラー: 必要なカラムが見つかりません: {e}", file=sys.stderr)
                sys.exit(1)
            
            if unblended_idx is None:
                print(f"エラー: '{unblended_cost_col}' カラムが見つかりません", file=sys.stderr)
                sys.exit(1)
            
            # データ行を処理
            for row in reader:
                row_count += 1
                
                if len(row) <= max(i for i in [net_unblended_idx, unblended_idx] if i is not None):
                    continue
                
                # コストを取得
                cost = get_cost(row, net_unblended_idx, unblended_idx)
                
                if cost > 0:
                    processed_count += 1
                    total_cost += cost
                    
                    # サービス名を取得
                    service_name = ''
                    if product_idx is not None and len(row) > product_idx:
                        service_name = parse_product_name(row[product_idx])
                    if not service_name and product_code_idx is not None and len(row) > product_code_idx:
                        service_name = row[product_code_idx].strip('"').strip("'")
                    if not service_name:
                        service_name = 'Unknown'
                    
                    # 日付を取得
                    date_str = ''
                    if usage_start_date_idx is not None and len(row) > usage_start_date_idx:
                        date_str = row[usage_start_date_idx].strip('"').strip("'")
                        # 日付をYYYY-MM-DD形式に変換（タイムスタンプ形式の場合）
                        if 'T' in date_str:
                            try:
                                dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                                date_str = dt.strftime('%Y-%m-%d')
                            except ValueError:
                                pass
                    
                    # 集計
                    if group_by in ['service', 'service_date']:
                        service_costs[service_name] += cost
                    
                    if group_by in ['date', 'service_date']:
                        if date_str:
                            date_costs[date_str] += cost
                    
                    if group_by == 'service_date':
                        if date_str:
                            service_date_costs[(service_name, date_str)] += cost
                    
    except FileNotFoundError:
        print(f"エラー: ファイルが見つかりません: {input_file}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"エラー: ファイル処理中にエラーが発生しました: {e}", file=sys.stderr)
        sys.exit(1)
    
    # 結果を表示
    print(f"=== コスト算出結果 ===")
    print(f"入力ファイル: {input_file}")
    print(f"総行数: {row_count:,}")
    print(f"コストが0より大きい行数: {processed_count:,}")
    print(f"合計コスト: ${total_cost:,.2f}")
    print()
    
    if group_by == 'all':
        print(f"合計コストのみを表示しました。")
        print(f"詳細な集計を見るには、--group-by オプションを使用してください。")
    
    if group_by in ['service', 'service_date']:
        print(f"=== サービス別コスト ===")
        sorted_services = sorted(service_costs.items(), key=lambda x: x[1], reverse=True)
        for service, cost in sorted_services:
            print(f"{service}: ${cost:,.2f}")
        print()
    
    if group_by in ['date', 'service_date']:
        print(f"=== 日別コスト ===")
        sorted_dates = sorted(date_costs.items())
        for date, cost in sorted_dates:
            print(f"{date}: ${cost:,.2f}")
        print()
    
    if group_by == 'service_date':
        print(f"=== サービス別 × 日別コスト ===")
        sorted_service_dates = sorted(service_date_costs.items(), key=lambda x: (x[0][1], x[1]), reverse=True)
        for (service, date), cost in sorted_service_dates[:50]:  # 上位50件のみ表示
            print(f"{date} | {service}: ${cost:,.2f}")
        if len(sorted_service_dates) > 50:
            print(f"... 他 {len(sorted_service_dates) - 50} 件")


def main():
    """メイン関数"""
    if len(sys.argv) < 2:
        print("使用方法: python calculate_costs.py <CSVファイルパス> [--group-by <all|service|date|service_date>]")
        print()
        print("オプション:")
        print("  --group-by: 集計方法を指定")
        print("    - all: 合計コストのみ（デフォルト）")
        print("    - service: サービス別に集計")
        print("    - date: 日別に集計")
        print("    - service_date: サービス別 × 日別に集計")
        print()
        print("例:")
        print("  python calculate_costs.py cur2-hourly-versioned-personal-00001.csv")
        print("  python calculate_costs.py cur2-hourly-versioned-personal-00001.csv --group-by service")
        print("  python calculate_costs.py cur2-hourly-versioned-personal-00001.csv --group-by service_date")
        sys.exit(1)
    
    input_file = sys.argv[1]
    group_by = 'all'
    
    # オプション解析
    if '--group-by' in sys.argv:
        idx = sys.argv.index('--group-by')
        if idx + 1 < len(sys.argv):
            group_by = sys.argv[idx + 1]
            if group_by not in ['all', 'service', 'date', 'service_date']:
                print(f"エラー: 無効な集計方法: {group_by}", file=sys.stderr)
                print("有効な値: all, service, date, service_date", file=sys.stderr)
                sys.exit(1)
    
    calculate_costs(input_file, group_by)


if __name__ == '__main__':
    main()

