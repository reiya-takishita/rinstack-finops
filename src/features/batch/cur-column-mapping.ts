/**
 * CURカラム名マッピング
 *
 * CUR 2.0形式（アンダースコア区切り）のカラム名マッピング
 *
 * 注意: `product`カラムはJSON形式で、`product_name`をパースする必要がある
 */
export const CUR_COLUMN_MAPPING = {
  USAGE_START_DATE: 'line_item_usage_start_date',
  UNBLENDED_COST: 'line_item_unblended_cost',
  NET_UNBLENDED_COST: 'line_item_net_unblended_cost', // クレジット適用後のコスト（優先的に使用）
  CURRENCY_CODE: 'line_item_currency_code',
  PRODUCT: 'product', // JSON形式のカラム（product_nameを含む）
  PRODUCT_SERVICECODE: 'product_servicecode', // サービスコード
  PRODUCT_CODE: 'line_item_product_code', // フォールバック用
} as const;

export type CurColumnMappingKey = keyof typeof CUR_COLUMN_MAPPING;
