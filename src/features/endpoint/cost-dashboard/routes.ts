import express, { Router } from 'express';

const router = Router();

router.get('/projects/:projectId/dashboard/summary', (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  res.json({
    projectId,
    billingPeriod: '2025-11',
    totalCost: 154345,
    executedActionsCount: 0,
    optimizationProposalsCount: 0,
    forecastCost: 172159,
    previousSamePeriodCost: 158975,
    previousMonthTotalCost: 203164,
    costReducedByActions: 0,
    lastUpdatedAt: '2025-11-29T12:34:56Z',
  });
});

router.get('/projects/:projectId/dashboard/services-monthly', (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  res.json({
    projectId,
    months: ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11'],
    services: [
      {
        serviceName: 'Amazon Simple Storage Service',
        costs: [52156, 57318, 48611, 63910, 52148, 66151, 48215, 37910],
      },
      {
        serviceName: 'Amazon Elastic Container Service',
        costs: [66236, 77341, 58125, 80214, 88341, 73913, 148461, 92314],
      },
      {
        serviceName: 'Amazon Cloud Front',
        costs: [21109, 22546, 22325, 21943, 22001, 22114, 22164, 21119],
      },
    ],
  });
});

router.get('/projects/:projectId/dashboard/history', (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  res.json({
    projectId,
    months: ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11'],
    rows: [
      {
        serviceName: 'Simple Storage Service',
        monthlyCosts: [52156, 57318, 48611, 63910, 52148, 66151, 48215, 37910],
      },
      {
        serviceName: 'Elastic Container Service',
        monthlyCosts: [66236, 77341, 58125, 80214, 88341, 73913, 148461, 92314],
      },
      {
        serviceName: 'Cloud Front',
        monthlyCosts: [21109, 22546, 22325, 21943, 22001, 22114, 22164, 21119],
      },
    ],
  });
});

export default router;
