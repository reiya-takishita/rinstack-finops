import { createErrorFactory } from './error-factory';

// =============================================================================
// LOGGER CONFIGURATION
// =============================================================================

const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'it';

// ANSIカラーコード
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

// ログレベルごとの色設定
const levelColors = {
  info: colors.green,
  error: colors.red,
  warn: colors.yellow,
  debug: colors.cyan,
  trace: colors.magenta,
  fatal: colors.red + colors.bright,
};

const formatTokyoTimestamp = (): string => {
  const now = new Date();
  const d = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const [datePart, timePart] = d.split(' ');
  const millis = String(now.getMilliseconds()).padStart(3, '0');
  return `${datePart.replace(/\//g, '-')} ${timePart}.${millis}`;
};

// 秘匿性のある情報に対してマスクする
const masking = (data: string) => {
	let masked = data;

	// JSON 形式のシークレット値をマスク
	masked = masked.replace(
		/("(password|client_secret|access_token|refresh_token|api_key)"\s*:\s*)"[^"]*"/gi,
		'$1"****"',
	);

	// x-www-form-urlencoded 形式のシークレット値をマスク
	masked = masked.replace(
		/\b(password|client_secret|access_token|refresh_token|api_key)\s*=\s*[^&\s]*/gi,
		'$1=****',
	);

	// JSON 形式の Authorization: Bearer をマスク
	masked = masked.replace(
		/("Authorization"\s*:\s*")((?:Bearer|Token|Basic)\s+)[^"]*(")/gi,
		'$1$2****$3',
	);

	// x-www-form-urlencoded 形式の Authorization をマスク
	masked = masked.replace(
		/\bAuthorization\s*=\s*(?:Bearer|Token|Basic)\s+[^&\s]*/gi,
		'Authorization=Bearer ****',
	);

	// FinOps: アクセスキーIDをマスク（AKIAで始まる20文字の文字列）
	masked = masked.replace(
		/("(accessKeyId|access_key_id)"\s*:\s*)"(AKIA[0-9A-Z]{16})"/gi,
		(_, prefix, key, value) => {
			const maskedValue = `${value.substring(0, 4)}****${value.substring(value.length - 4)}`;
			return `${prefix}"${maskedValue}"`;
		}
	);

	// FinOps: シークレットアクセスキーをマスク
	masked = masked.replace(
		/("(secretAccessKey|secret_access_key)"\s*:\s*)"[^"]{40,}"/gi,
		'$1"****"',
	);

	return masked;
}

// シンプルなログ出力関数
const formatMessage = (level: string, message: string, data?: any) => {
  const timestamp = formatTokyoTimestamp();
  const dataStr = data ? ` ${masking(JSON.stringify(data))}` : '';
  
  if (isDevelopment) {
    const levelColor = levelColors[level as keyof typeof levelColors] || colors.white;
    const timestampColor = colors.gray;
    return `${timestampColor}[${timestamp}]${colors.reset} ${levelColor}[${level.toUpperCase()}]${colors.reset} ${message}${dataStr}`;
  } else {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
  }
};

// ログ出力関数
export const logInfo = (message: string, data?: any) => {
  console.log(formatMessage('info', message, data));
};

export const logError = (message: string, error?: any) => {
  console.error(formatMessage('error', message, error));
};

export const logWarn = (message: string, data?: any) => {
  console.warn(formatMessage('warn', message, data));
};

export const logDebug = (message: string, data?: any) => {
  if (isDevelopment) {
    console.debug(formatMessage('debug', message, data));
  }
};

export const logTrace = (message: string, data?: any) => {
  if (isDevelopment) {
    console.trace(formatMessage('trace', message, data));
  }
};

export const logFatal = (message: string, error?: any) => {
  console.error(formatMessage('fatal', message, error));
};

// エラーコード定義
export enum AuthErrorCode {
  INVALID_CREDENTIALS = 'AUTH_001',
  INVALID_TOKEN = 'AUTH_002',
  TOKEN_EXPIRED = 'AUTH_003',
  UNAUTHORIZED_ACCESS = 'AUTH_004',
  INVALID_USER_TYPE = 'AUTH_005',
  INVALID_AUTH_PROVIDER = 'AUTH_006',
  MISSING_AUTH_HEADER = 'AUTH_007',
}

export enum SystemErrorCode {
  INTERNAL_SERVER_ERROR = 'SYS_001',
  DATABASE_ERROR = 'SYS_002',
  NETWORK_ERROR = 'SYS_003',
  FILE_NOT_FOUND = 'SYS_004',
  PERMISSION_DENIED = 'SYS_005',
  RESOURCE_NOT_FOUND = 'SYS_006',
  VALIDATION_ERROR = 'SYS_007',
  TIMEOUT_ERROR = 'SYS_008',
  ENVIRONMENT_VARIABLE_MISSING = 'SYS_009',
  RESOURCE_NOT_READY = 'SYS_010',
  INVALID_INPUT = 'SYS_011',
  S3_ERROR = 'SYS_012',
  UNKNOWN_ERROR = 'SYS_999',
}

export enum BusinessErrorCode {
  DUPLICATE_RESOURCE = 'BIZ_001',
  INVALID_OPERATION = 'BIZ_002',
  RESOURCE_LIMIT_EXCEEDED = 'BIZ_003',
  DEPENDENCY_VIOLATION = 'BIZ_004',
  BUSINESS_RULE_VIOLATION = 'BIZ_005',
  INVALID_STATE_TRANSITION = 'BIZ_006',
  PLAN_LIMIT_EXCEEDED = 'PLAN_LIMIT_EXCEEDED',
}

// エラーファクトリー（console.logベース）
const mockLogger = {
  error: (error: any, message: string) => logError(message, error),
  warn: (data: any, message: string) => logWarn(message, data),
  info: (data: any, message: string) => logInfo(message, data),
};

const { createAuthError, createSystemError, createBusinessError } = createErrorFactory(mockLogger as any);

export { createAuthError, createSystemError, createBusinessError };

export default mockLogger;  