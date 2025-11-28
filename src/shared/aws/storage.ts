import { S3Client } from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SESClient } from '@aws-sdk/client-ses';
import { getEnvVariable } from '../database';

// AWS設定
const AWS_REGION = getEnvVariable('AWS_REGION');

// AWS共通設定
const awsConfig = {
  region: AWS_REGION,
};

// S3クライアント
export const s3Client = new S3Client(awsConfig);

// Cognitoクライアント
export const cognitoClient = new CognitoIdentityProviderClient(awsConfig);

// SESクライアント
export const sesClient = new SESClient(awsConfig);

// S3バケット名
export const S3_BUCKET_NAME = getEnvVariable('AWS_S3_BUCKET_NAME_RINSTACK');

// CloudFront URL
export const CLOUDFRONT_URL = getEnvVariable('CLOUDFRONT_DOMAIN');

// S3設定オブジェクト
export const s3Config = {
  bucketName: S3_BUCKET_NAME,
  region: AWS_REGION,
  cloudfrontUrl: CLOUDFRONT_URL,
};

// Cognito設定オブジェクト
export const cognitoConfig = {
  region: AWS_REGION,
  adminUserPoolId: getEnvVariable('COGNITO_ADMIN_USER_POOL_ID'),
  adminClientId: getEnvVariable('COGNITO_ADMIN_CLIENT_ID'),
  appUserPoolId: getEnvVariable('COGNITO_APP_USER_POOL_ID'),
  appClientId: getEnvVariable('COGNITO_APP_CLIENT_ID'),
  domain: getEnvVariable('COGNITO_DOMAIN'),
  redirectUri: getEnvVariable('COGNITO_REDIRECT_URI'),
  googleIdpIdentifier: getEnvVariable('COGNITO_GOOGLE_IDP_IDENTIFIER'),
  oauthScopes: getEnvVariable('COGNITO_OAUTH_SCOPES'),
};

// =============================================================================
// S3 INFRASTRUCTURE FILE MANAGEMENT
// ============================================================================= 