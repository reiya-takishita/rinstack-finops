/**
 * CURカラム名マッピング
 * 
 * 要件定義: cur-batch-requirements.md 2.1.2
 * 
 * CUR 2.0形式（アンダースコア区切り）のカラム名マッピング
 * 
 * 注意: `product`カラムはJSON形式で、`product_name`をパースする必要がある
 */
export const CUR_COLUMN_MAPPING = {
  USAGE_START_DATE: 'line_item_usage_start_date',
  UNBLENDED_COST: 'line_item_unblended_cost',
  NET_UNBLENDED_COST: 'line_item_net_unblended_cost', // クレジット適用後のコスト（優先的に使用）
  USAGE_AMOUNT: 'line_item_usage_amount',
  PRODUCT: 'product', // JSON形式のカラム（product_nameを含む）
  PRODUCT_CODE: 'line_item_product_code', // フォールバック用
  LINE_ITEM_TYPE: 'line_item_line_item_type', // Usage, Tax, Credit, Refundなど
  USAGE_ACCOUNT_ID: 'line_item_usage_account_id', // 使用量が発生したAWSアカウントID
  RESERVATION_EFFECTIVE_COST: 'reservation_effective_cost', // 予約インスタンスの有効コスト
  SAVINGS_PLAN_EFFECTIVE_COST: 'savings_plan_savings_plan_effective_cost', // Savings Planの有効コスト
} as const;

export type CurColumnMappingKey = keyof typeof CUR_COLUMN_MAPPING;

