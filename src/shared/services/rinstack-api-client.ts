import axios, { AxiosInstance } from 'axios';
import jwt from 'jsonwebtoken';
import { getEnvVariable, getEnvVariableWithDefault } from '../database/environment';
import { logInfo, logError } from '../logger';

/**
 * rinstack-appへのHTTPクライアント
 * FinOpsからrinstack-appのAPIを呼び出すためのS2S認証付きクライアント
 */
export class RinstackApiClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor() {
    this.baseUrl = getEnvVariableWithDefault('RINSTACK_API_BASE_URL', 'http://backend-rinstack:7070');
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Rinstack-FinOps/1.0.0'
      }
    });

    // リクエストインターセプター（S2S認証）
    this.client.interceptors.request.use((config) => {
      const token = this.generateServiceToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    // レスポンスインターセプター（エラーハンドリング）
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logError('[RinstackApiClient] API error', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
          code: error.code,
        });
        throw error;
      }
    );
  }

  /**
   * S2S JWT認証トークン生成
   * FinOpsからrinstack-appへの呼び出し用
   */
  private generateServiceToken(): string {
    const payload = {
      iss: 'finops-service',
      aud: 'rinstack-app',
      client_id: 'finops-service',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (60 * 5) // 5分間有効
    };

    const secret = getEnvVariable('S2S_JWT_SECRET');
    return jwt.sign(payload, secret);
  }

  /**
   * 固定値ACU消費APIを呼び出す
   * 
   * @param projectId プロジェクトID（必須、プロジェクトIDから組織IDを自動取得）
   * @param acuAmount ACU消費量（必須）
   * @returns ACU消費結果
   */
  async consumeFixedAcu(
    projectId: string,
    acuAmount: number
  ): Promise<{
    success: boolean;
    consumption: {
      consumed: number;
      balance: number;
      overdrawn: boolean;
      transactionId: string;
      breakdown: {
        fromSubscription: number;
        fromExtra: number;
        overdrawAmount: number;
      };
    };
    timestamp: string;
  }> {
    try {
      logInfo('[RinstackApiClient] Consuming fixed ACU', {
        projectId,
        acuAmount,
      });

      const response = await this.client.post(
        '/api/v1/admin/stripe/acu/consume-fixed',
        {
          projectId,
          acuAmount,
          activityType: 'FINOPS_CUR_ANALYSIS',
        }
      );

      return response.data;
    } catch (error: any) {
      logError('[RinstackApiClient] Failed to consume fixed ACU', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        code: error.code,
      });
      throw error;
    }
  }
}

// シングルトンインスタンスをエクスポート
export const rinstackApiClient = new RinstackApiClient();

