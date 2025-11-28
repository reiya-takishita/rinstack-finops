// Express.Requestのuser型を再利用可能にエクスポート
export interface IUser {
  id: string;
  email?: string;
  cognitoUsername?: string;
  provider?: string;
  systemRole?: string;
}

declare global {
  namespace Express {
    interface Request {
      authorityStatusCode?: string; // 権限コード（メイン）
      user?: IUser;
      requestId?: string;
      operatorId?: string;
    }
  }
}

// このファイルをモジュールとして扱うために必要
export {};