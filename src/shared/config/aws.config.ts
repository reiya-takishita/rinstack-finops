export const AWS_CONFIG = {
  cloudfront: {
    keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID || '',
    privateKeyPath: process.env.CLOUDFRONT_PRIVATE_KEY_PATH || 'keys/private-key.pem',
    distributionDomain: process.env.CLOUDFRONT_DOMAIN_NAME_RINSTACK || '',
  },
  s3: {
    bucket: process.env.AWS_S3_BUCKET_NAME_RINSTACK || '',
    region: process.env.AWS_REGION || 'ap-northeast-1',
  }
} as const;

// 設定値の検証
if (!AWS_CONFIG.cloudfront.keyPairId) {
  throw new Error('CLOUDFRONT_KEY_PAIR_ID is not set');
}

if (!AWS_CONFIG.cloudfront.distributionDomain) {
  throw new Error('CLOUDFRONT_DISTRIBUTION_DOMAIN is not set');
}

if (!AWS_CONFIG.s3.bucket) {
  throw new Error('AWS_S3_BUCKET is not set');
}
