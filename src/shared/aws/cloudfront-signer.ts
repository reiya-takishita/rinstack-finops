import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import * as fs from 'fs';
import * as path from 'path';

interface SignedUrlOptions {
  keyPairId: string;
  privateKeyPath: string;
  url: string;
  expiresIn?: number; // seconds
}

export class CloudFrontUrlSigner {
  private static readonly DEFAULT_EXPIRATION = 3600; // 1時間

  /**
   * CloudFrontの署名付きURLを生成します
   * @param options 署名オプション
   * @returns 署名付きURL
   */
  public static async getSignedUrl(options: SignedUrlOptions): Promise<string> {
    const {
      keyPairId,
      privateKeyPath,
      url,
      expiresIn = this.DEFAULT_EXPIRATION
    } = options;

    try {
      // 秘密鍵の読み込み
      const privateKey = fs.readFileSync(
        path.resolve(process.cwd(), privateKeyPath),
        'utf-8'
      );

      // 有効期限の設定
      const dateLessThan = new Date(Date.now() + expiresIn * 1000);

      // 署名付きURLの生成
      const signedUrl = getSignedUrl({
        url,
        keyPairId,
        privateKey,
        dateLessThan
      });

      return signedUrl;
    } catch (error) {
      console.error('Failed to generate signed URL:', error);
      throw new Error('署名付きURLの生成に失敗しました');
    }
  }
}
