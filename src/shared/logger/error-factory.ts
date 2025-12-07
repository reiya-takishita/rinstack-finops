import { Logger } from 'pino';

// カスタムエラークラス
export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class SystemError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'SystemError';
  }
}

export class BusinessError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}

// エラーファクトリー関数
export const createErrorFactory = (logger: Logger) => {
  return {
    createAuthError: (code: string, message: string, statusCode: number = 401): AuthError => {
      const error = new AuthError(code, message, statusCode);
      logger.warn({ code, statusCode }, message);
      return error;
    },

    createSystemError: (code: string, message: string, statusCode: number = 500): SystemError => {
      const error = new SystemError(code, message, statusCode);
      logger.error({ code, statusCode }, message);
      return error;
    },

    createBusinessError: (code: string, message: string, statusCode: number = 400): BusinessError => {
      const error = new BusinessError(code, message, statusCode);
      logger.error({ code, statusCode }, message);
      return error;
    },
  };
};