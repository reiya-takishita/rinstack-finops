import { Router } from 'express';
import awsConnectionRoutes from '../features/endpoint/aws-connection/routes';
import costDashboardRoutes from '../features/endpoint/cost-dashboard/routes';

const router = Router();

router.use('/finops', awsConnectionRoutes);
router.use('/finops', costDashboardRoutes);

export default router;
