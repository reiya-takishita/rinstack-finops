/**
 * CURカラム名マッピング
 * 
 * 要件定義: cur-batch-requirements.md 2.1.2
 * 
 * 実装方針:
 * - CUR 1.0形式（スラッシュ区切り）で実装予定
 * - 将来CUR 2.0形式（アンダースコア区切り）への置換を容易にするため、マッピングを定義
 * 
 * 注意: モックデータはCUR 2.0形式のため、一時的にCUR 2.0形式のマッピングを使用
 */
export const CUR_COLUMN_MAPPING = {
  // CUR 1.0形式（将来の実装）
  // USAGE_START_DATE: 'lineItem/UsageStartDate',
  // UNBLENDED_COST: 'lineItem/UnblendedCost',
  // USAGE_AMOUNT: 'lineItem/UsageAmount',
  // PRODUCT_NAME: 'product/ProductName',

  // CUR 2.0形式（モックデータ用・一時的）
  USAGE_START_DATE: 'line_item_usage_start_date',
  UNBLENDED_COST: 'line_item_unblended_cost',
  USAGE_AMOUNT: 'line_item_usage_amount',
  PRODUCT_NAME: 'product_product_name',
} as const;

export type CurColumnMappingKey = keyof typeof CUR_COLUMN_MAPPING;

