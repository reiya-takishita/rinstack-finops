import * as crypto from 'crypto';
import { getEnvVariable } from '../database';
import { EncryptionAlgorithm } from './types';

// 暗号化ユーティリティクラス
class CryptUtils {
  private algorithm: crypto.CipherGCMTypes;
  private key: Buffer; // 32 bytes for AES-256-GCM

  constructor() {
    const secretKey = getEnvVariable('ENCRYPTION_KEY');
    // 固定長キー（32bytes）に伸長（SHA-256）
    this.key = crypto.createHash('sha256').update(secretKey, 'utf8').digest();
    this.algorithm = EncryptionAlgorithm.AES_256_GCM as crypto.CipherGCMTypes; // 'aes-256-gcm'
  }

  // テキストを暗号化（AES-256-GCM）
  public encrypt(text: string): string {
    try {
      const iv = crypto.randomBytes(12); // GCM推奨12 bytes
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv) as crypto.CipherGCM;
      const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const payload = {
        v: 1,
        alg: this.algorithm,
        iv: iv.toString('base64'),
        tag: authTag.toString('base64'),
        data: ciphertext.toString('base64'),
      };
      return JSON.stringify(payload);
    } catch (error) {
      throw new Error(`Encryption failed: ${error}`);
    }
  }

  // 暗号化されたテキストを復号化（AES-256-GCM）
  public decrypt(encryptedText: string): string {
    try {
      const payload = JSON.parse(encryptedText);
      if (!payload || payload.v !== 1 || payload.alg !== this.algorithm) {
        throw new Error('Unsupported encrypted payload format');
      }
      const iv = Buffer.from(payload.iv, 'base64');
      const tag = Buffer.from(payload.tag, 'base64');
      const data = Buffer.from(payload.data, 'base64');
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv) as crypto.DecipherGCM;
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      return plaintext;
    } catch (error) {
      throw new Error(`Decryption failed: ${error}`);
    }
  }

  // ハッシュを作成
  public createHash(data: string, algorithm: string = 'sha256'): string {
    try {
      return crypto.createHash(algorithm).update(data).digest('hex');
    } catch (error) {
      throw new Error(`Hash creation failed: ${error}`);
    }
  }

  // HMACを作成
  public createHmac(data: string, algorithm: string = 'sha256', secret?: string | Buffer): string {
    try {
      const hmacSecret: string | Buffer = secret ?? this.key;
      return crypto.createHmac(algorithm, hmacSecret).update(data).digest('hex');
    } catch (error) {
      throw new Error(`HMAC creation failed: ${error}`);
    }
  }

  // ランダムトークンを生成
  public generateRandomToken(length: number = 32): string {
    try {
      return crypto.randomBytes(length).toString('hex');
    } catch (error) {
      throw new Error(`Random token generation failed: ${error}`);
    }
  }

  // パスワードをハッシュ化
  public hashPassword(password: string, saltRounds: number = 10): string {
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, saltRounds * 1000, 64, 'sha256').toString('hex');
      return `${salt}:${hash}`;
    } catch (error) {
      throw new Error(`Password hashing failed: ${error}`);
    }
  }

  // パスワード検証
  public verifyPassword(password: string, hashedPassword: string): boolean {
    try {
      const [salt, hash] = hashedPassword.split(':');
      const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');
      return hash === verifyHash;
    } catch (error) {
      throw new Error(`Password verification failed: ${error}`);
    }
  }
}

// シングルトンインスタンス
export const cryptUtils = new CryptUtils(); 