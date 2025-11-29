import { Router } from 'express';
import awsConnectionRoutes from '../features/endpoint/aws-connection/routes';
import costDashboardRoutes from '../features/endpoint/cost-dashboard/routes';
import batchRoutes from '../features/endpoint/batch/routes';

const router = Router();

router.use('/finops', awsConnectionRoutes);
router.use('/finops', costDashboardRoutes);
router.use('/finops', batchRoutes);

export default router;
