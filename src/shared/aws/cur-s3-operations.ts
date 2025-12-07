import { S3Client, ListObjectsV2Command, GetObjectCommand, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { logInfo, logError } from '../logger';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

/**
 * CUR用のS3クライアントを作成
 * @param accessKeyId AWSアクセスキーID
 * @param secretAccessKey AWSシークレットアクセスキー
 * @param region AWSリージョン（デフォルト: ap-northeast-1）
 * @returns S3クライアント
 */
export function createCurS3Client(
  accessKeyId: string,
  secretAccessKey: string,
  region: string = 'ap-northeast-1'
): S3Client {
  return new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * CURファイル一覧を取得
 * @param s3Client S3クライアント
 * @param bucketName S3バケット名
 * @param prefix プレフィックス（例: reports/cur2-daily-versioned-personal/data/）
 * @returns S3オブジェクトキーと最終更新日時の配列
 */
export async function listCurFiles(
  s3Client: S3Client,
  bucketName: string,
  prefix: string
): Promise<{ key: string; lastModified?: Date }[]> {
  const items: { key: string; lastModified?: Date }[] = [];
  let continuationToken: string | undefined = undefined;

  try {
    // プレフィックスの末尾に/がない場合は追加
    const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/';

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      });

      const response: ListObjectsV2CommandOutput = await s3Client.send(command);

      (response.Contents ?? []).forEach((obj) => {
        if (obj.Key && (obj.Key.endsWith('.csv') || obj.Key.endsWith('.csv.gz'))) {
          items.push({ key: obj.Key, lastModified: obj.LastModified });
        }
      });

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    logInfo('[CUR S3] Files listed successfully', {
      bucketName,
      prefix: normalizedPrefix,
      count: items.length
    });

    return items;
  } catch (error) {
    logError('[CUR S3] Failed to list files', { bucketName, prefix, error });
    throw error;
  }
}

/**
 * CURファイルをS3からダウンロードして解凍
 * @param s3Client S3クライアント
 * @param bucketName S3バケット名
 * @param objectKey S3オブジェクトキー
 * @returns 解凍されたCSVファイルの内容（文字列）
 */
export async function downloadAndDecompressCurFile(
  s3Client: S3Client,
  bucketName: string,
  objectKey: string
): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    });

    const response = await s3Client.send(command);
    const body = response.Body;

    if (!body) {
      throw new Error('Empty response body');
    }

    // バイト配列として取得
    const data = await body.transformToByteArray();
    const buffer = Buffer.from(data);

    // gzipファイルの場合は解凍
    if (objectKey.endsWith('.gz')) {
      const decompressed = await gunzip(buffer);
      const content = decompressed.toString('utf-8');

      logInfo('[CUR S3] File downloaded and decompressed', {
        bucketName,
        objectKey,
        size: buffer.length,
        decompressedSize: decompressed.length
      });

      return content;
    } else {
      // 通常のCSVファイル
      const content = buffer.toString('utf-8');

      logInfo('[CUR S3] File downloaded', {
        bucketName,
        objectKey,
        size: buffer.length
      });

      return content;
    }
  } catch (error) {
    logError('[CUR S3] Failed to download file', { bucketName, objectKey, error });
    throw error;
  }
}

