import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, ListObjectsV2CommandOutput, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, s3Config } from './storage';
import { logInfo, logError } from '../logger';
import * as fs from 'fs/promises';
import * as path from 'path';

// =============================================================================
// INFRASTRUCTURE FILE MANAGEMENT
// =============================================================================

const INFRA_GENERATED_PREFIX = 'terraform/generated/';

/**
 * Uploads a file content to S3.
 * @param key The S3 object key.
 * @param content The file content (string or Buffer).
 * @returns The result of the PutObjectCommand.
 */
export const uploadInfraFile = async (key: string, content: string | Buffer) => {
  const params = {
    Bucket: s3Config.bucketName,
    Key: key,
    Body: typeof content === 'string' ? content : Buffer.from(content),
    ContentType: 'text/plain',
  };
  const command = new PutObjectCommand(params);
  const result = await s3Client.send(command);
  
  return result;
};

/**
 * Downloads a YAML file content from S3.
 * @param key The S3 object key.
 * @returns The file content as a string.
 */
export const getInfraFile = async (key: string): Promise<string> => {
  const params = {
    Bucket: s3Config.bucketName,
    Key: key,
  };
  const command = new GetObjectCommand(params);
  const response = await s3Client.send(command);
  const body = response.Body;
  if (!body) {
    throw new Error('Empty response body');
  }
  return body.transformToString();
};

/**
 * Generates a key for a generated Terraform file.
 * @param projectId The project ID.
 * @param infraId The infrastructure request ID.
 * @param filePath The file path within the infra request (e.g., 'main.tf.yaml').
 * @returns The full S3 key.
 */
export const generateGeneratedFileKey = (projectId: string, infraId: string, filePath: string) => {
  return `${INFRA_GENERATED_PREFIX}${projectId}/${infraId}/${filePath}`;
};

// S3プレフィックス配下のキー一覧取得（ページネーション対応）
export const listS3KeysUnderPrefix = async (prefix: string): Promise<string[]> => {
  const keys: string[] = [];
  let continuationToken: string | undefined = undefined;

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: s3Config.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const response: ListObjectsV2CommandOutput = await s3Client.send(command);
      (response.Contents ?? []).forEach((obj) => {
        if (obj.Key) keys.push(obj.Key);
      });
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    logInfo('S3 keys listed successfully', { prefix, count: keys.length });
    return keys;
  } catch (error) {
    logError('Failed to list S3 keys', { prefix, error });
    throw error;
  }
};

// S3内コピー（同一バケット）
export const copyInfraFile = async (sourceKey: string, destinationKey: string): Promise<void> => {
  try {
    const command = new CopyObjectCommand({
      Bucket: s3Config.bucketName,
      CopySource: `${s3Config.bucketName}/${sourceKey}`,
      Key: destinationKey,
      ContentType: 'text/plain',
    });
    await s3Client.send(command);
    logInfo('S3 object copied successfully', { sourceKey, destinationKey });
  } catch (error) {
    logError('Failed to copy S3 object', { sourceKey, destinationKey, error });
    throw error;
  }
};

/**
 * S3プレフィックス配下の全ファイルを再帰的にコピー（メタデータを保持）
 * @param srcPrefix コピー元のS3プレフィックス（例: 'terraform/generated/project1/group1/.git/'）
 * @param dstPrefix コピー先のS3プレフィックス（例: 'terraform/generated/project1/group2/.git/'）
 * @param concurrency 並列実行数（デフォルト: 5）
 */
export const copyPrefixRecursive = async (
  srcPrefix: string,
  dstPrefix: string,
  concurrency: number = 5
): Promise<void> => {
  // S3のprefixは末尾/を付けておくと安全
  const normSrc = srcPrefix.endsWith('/') ? srcPrefix : srcPrefix + '/';
  const normDst = dstPrefix.endsWith('/') ? dstPrefix : dstPrefix + '/';

  const copiedKeys: string[] = [];

  try {
    // listS3KeysUnderPrefixを使用して、確実にすべてのキーを取得
    const allKeys = await listS3KeysUnderPrefix(normSrc);
    
    logInfo('Starting recursive copy', {
      srcPrefix: normSrc,
      dstPrefix: normDst,
      totalKeys: allKeys.length,
    });

    if (allKeys.length === 0) {
      logInfo('No files to copy', { srcPrefix: normSrc });
      return;
    }

    const pool: Promise<any>[] = [];
    let totalCopied = 0;
    let totalFailed = 0;
    const errors: Array<{ srcKey: string; dstKey: string; error: any }> = [];

    for (const srcKey of allKeys) {
      // 元prefixを新prefixへ置換して"フォルダ構造"維持
      const dstKey = normDst + srcKey.substring(normSrc.length);

      const p = s3Client
        .send(
          new CopyObjectCommand({
            Bucket: s3Config.bucketName,
            Key: dstKey,
            CopySource: `${s3Config.bucketName}/${srcKey}`,
            MetadataDirective: 'COPY', // 元のメタデータ（ContentTypeなど）を保持
          })
        )
        .then(() => {
          totalCopied++;
          copiedKeys.push(dstKey);
          // ログは大量になるため、10件ごとにのみ出力
          if (totalCopied % 10 === 0 || totalCopied <= 5) {
            logInfo('Copied file in S3', { srcKey, dstKey, totalCopied, totalFiles: allKeys.length });
          }
        })
        .catch((error) => {
          totalFailed++;
          const errorInfo = { srcKey, dstKey, error: error instanceof Error ? error.message : String(error) };
          errors.push(errorInfo);
          logError('Failed to copy individual file', errorInfo);
          // エラーを再スローしない（他のファイルのコピーを続行するため）
        });

      pool.push(p);

      // 簡易的な並列制御
      if (pool.length >= concurrency) {
        const results = await Promise.allSettled(pool);
        // エラーをチェック
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            // エラーは既にcatchで処理済み
          }
        });
        pool.length = 0;
      }
    }

    // 残りのタスクを処理
    if (pool.length > 0) {
      const results = await Promise.allSettled(pool);
      results.forEach((result) => {
        if (result.status === 'rejected') {
          // エラーは既にcatchで処理済み
        }
      });
    }


    // エラーがあった場合は例外をスロー
    if (totalFailed > 0) {
      logError('Some files failed to copy', {
        srcPrefix: normSrc,
        dstPrefix: normDst,
        totalCopied,
        totalFailed,
        totalFiles: allKeys.length,
        errors: errors.slice(0, 10), // 最初の10件のエラーのみログ
      });
      throw new Error(`Failed to copy ${totalFailed} out of ${allKeys.length} files from ${normSrc} to ${normDst}. First error: ${errors[0]?.error}`);
    }

    logInfo('S3 prefix copied recursively with metadata preserved', {
      srcPrefix: normSrc,
      dstPrefix: normDst,
      totalCopied,
      totalFiles: allKeys.length,
    });
  } catch (error) {
    logError('Failed to copy S3 prefix recursively', { srcPrefix: normSrc, dstPrefix: normDst, error });
    throw error;
  }
};

// =============================================================================
// ATTACHMENT FILE OPERATIONS
// =============================================================================

export { generatePresignedDownloadUrl };

// ファイルアップロード用Presigned URL生成
export const generatePresignedUploadUrl = async (
  key: string,
  contentType: string
): Promise<string> => {
  try {
    const command = new PutObjectCommand({
      Bucket: s3Config.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 }); // 10分間有効
    logInfo('Presigned upload URL generated successfully', { key, contentType });
    return presignedUrl;
  } catch (error) {
    logError('Failed to generate presigned upload URL', error);
    throw error;
  }
};

// ファイルダウンロード用Presigned URL生成
const generatePresignedDownloadUrl = async (
  filePath: string,
  expiresIn: number = 3600
): Promise<string> => {
  try {
    const command = new GetObjectCommand({
      Bucket: s3Config.bucketName,
      Key: filePath,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    logInfo('Presigned download URL generated successfully', { filePath });
    return presignedUrl;
  } catch (error) {
    logError('Failed to generate presigned download URL', error);
    throw error;
  }
};

// ファイル削除
export const deleteFile = async (filePath: string): Promise<void> => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: s3Config.bucketName,
      Key: filePath,
    });

    await s3Client.send(command);
    logInfo('File deleted successfully', { filePath });
  } catch (error) {
    logError('Failed to delete file', error);
    throw error;
  }
};

// CloudFront URL生成
export const generateCloudfrontUrl = (filePath: string): string => {
  const base = s3Config.cloudfrontUrl.startsWith('http')
    ? s3Config.cloudfrontUrl.replace(/^http:\/\//, 'https://')
    : `https://${s3Config.cloudfrontUrl}`;
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return `${base}/${encoded}`;
};

// ファイルパス生成
export const generateFilePath = (
  fileName: string,
  attachmentFileId: string,
  directory: string
): string => {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${directory}/${timestamp}/${attachmentFileId}_${fileName}`;
};

// ファイルメタデータ
export interface FileMetadata {
  attachmentFileName: string;
  contentType: string;
  fileSize: number;
  attachmentType: string;
}

// ファイル情報
export interface FileInfo {
  attachmentFileId: string;
  attachmentFileName: string;
  s3Key: string;
  contentType: string;
  fileSize: number;
  attachmentType: string;
  attachmentSourceId: string;
  createdBy: string;
  updatedBy: string;
}

// ファイル情報作成
export const createFileInfo = (metadata: FileMetadata, attachmentFileId: string, s3Key: string, userId: string): FileInfo => {
  return {
    attachmentFileId,
    attachmentFileName: metadata.attachmentFileName,
    s3Key,
    contentType: metadata.contentType,
    fileSize: metadata.fileSize,
    attachmentType: metadata.attachmentType,
    attachmentSourceId: '', // この時点ではソースIDは不明
    createdBy: userId,
    updatedBy: userId,
  };
};

/**
 * ディレクトリを再帰的にS3にアップロード
 */
export const uploadDirectoryToS3 = async (
  localDirPath: string,
  s3Prefix: string
): Promise<void> => {
  const walkDir = async (dirPath: string, relativePath: string = ''): Promise<void> => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativeFilePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const s3Key = `${s3Prefix}${relativeFilePath}`;
      
      if (entry.isDirectory()) {
        await walkDir(fullPath, relativeFilePath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath);
          await uploadInfraFile(s3Key, content);
          logInfo('Uploaded file to S3', { localPath: fullPath, s3Key });
        } catch (error) {
          logError('Failed to upload file to S3', { localPath: fullPath, s3Key, error });
          throw error;
        }
      }
    }
  };
  
  await walkDir(localDirPath);
  logInfo('Directory uploaded to S3', { localDirPath, s3Prefix });
};

/**
 * S3上のプレフィックス配下のファイル群をローカルディレクトリに再帰的にダウンロード
 */
export const downloadDirectoryFromS3 = async (
  s3Prefix: string,
  localDirPath: string
): Promise<void> => {
  try {
    const keys = await listS3KeysUnderPrefix(s3Prefix);

    if (!keys.length) {
      logInfo('No S3 objects found for prefix', { s3Prefix });
      return;
    }

    for (const key of keys) {
      if (!key.startsWith(s3Prefix)) {
        continue;
      }

      const relativePath = key.substring(s3Prefix.length);
      if (!relativePath || relativePath.endsWith('/')) {
        continue;
      }

      const localPath = path.join(localDirPath, relativePath);
      const dirPath = path.dirname(localPath);

      await fs.mkdir(dirPath, { recursive: true });

      const command = new GetObjectCommand({
        Bucket: s3Config.bucketName,
        Key: key,
      });

      const response = await s3Client.send(command);
      const body = response.Body;
      if (!body) {
        logError('Empty response body when downloading from S3', { key });
        continue;
      }

      const data = await body.transformToByteArray();
      await fs.writeFile(localPath, Buffer.from(data));
      logInfo('Downloaded file from S3', { key, localPath });
    }
  } catch (error) {
    logError('Failed to download directory from S3', { s3Prefix, localDirPath, error });
    throw error;
  }
};