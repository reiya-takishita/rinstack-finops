import express, { Router } from 'express';

const router = Router();

router.get('/projects/:projectId/connection', (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  res.json({
    projectId,
    awsAccountId: '123456789012',
    roleArn: 'arn:aws:iam::123456789012:role/RinstackFinOpsRole',
    externalId: 'optional-external-id',
    curBucketName: 'my-aws-cur-bucket',
    curPrefix: 'cost-reports/proj-123/',
  });
});

router.put('/projects/:projectId/connection', (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  // 本フェーズではロジック未実装のため、リクエストボディをそのまま返すダミー実装とする
  const body = req.body ?? {};

  res.json({
    projectId,
    awsAccountId: body.awsAccountId ?? '123456789012',
    roleArn: body.roleArn ?? 'arn:aws:iam::123456789012:role/RinstackFinOpsRole',
    externalId: body.externalId ?? 'optional-external-id',
    curBucketName: body.curBucketName ?? 'my-aws-cur-bucket',
    curPrefix: body.curPrefix ?? 'cost-reports/proj-123/',
  });
});

export default router;
