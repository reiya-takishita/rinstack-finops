import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import router from './routes';
import { checkConnection, initializeMasterData, sequelize } from './shared/database';
import { initModels } from './models/init-models';
import { logInfo } from './shared/logger';
import { APP_CONFIG } from './shared/config';
import { setupCurBatchSchedulers } from './features/batch/cur-batch.scheduler';
import { startCurBatchWorker } from './features/batch/cur-batch.worker';

const app = express();

// セキュリティミドルウェア
app.use(helmet());

// CORS設定（Cookie送信を許可）
app.use(cors({
  origin: APP_CONFIG.FRONTEND_BASE_URL,
  credentials: true,
}));

// ログ出力
app.use(morgan('combined'));

// JSON解析
app.use(express.json({ limit: APP_CONFIG.REQUEST_SIZE_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: APP_CONFIG.REQUEST_SIZE_LIMIT }));

// リクエスト毎にログを出力
const outputReqest = (req: express.Request, res: express.Response, next: express.NextFunction) => {

  const originalSend = res.send;

  // res.send関数を新しい関数で置き換える
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).send = function (body: unknown) {

    const loginfo = {
      request : {
        url: req.originalUrl,
        method: req.method,
        query: req.query,
        body: req.body,
        header: req.headers,
        user: req.user!,
      },
      response : {
        body: body,
      }
    };

    logInfo('[operation]', loginfo);

    originalSend.call(this, body);
  }

  next();
}

app.use(outputReqest);


// ルーターをマウント
app.use('/', router);


// エラーハンドリング
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(error.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// サーバー起動
const PORT = APP_CONFIG.PORT;

const startServer = async () => {
  try {
    // データベース接続確認
    await checkConnection();

    // モデル初期化
    initModels(sequelize);
    logInfo('Database models initialized successfully.');

    // マスターデータ初期化
    await initializeMasterData();

    // CURバッチワーカーの起動
    try {
      logInfo('Starting CUR batch worker...');
      await startCurBatchWorker();
      logInfo('CUR batch worker started successfully.');
    } catch (error) {
      console.error('Failed to start CUR batch worker:', error);
      console.error('Error details:', error instanceof Error ? error.stack : String(error));
      logInfo('Failed to start CUR batch worker (continuing without batch processing)', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    // CURバッチスケジューラーの起動
    try {
      logInfo('Starting CUR batch scheduler...');
      await setupCurBatchSchedulers();
      logInfo('CUR batch scheduler started successfully.');
    } catch (error) {
      console.error('Failed to start CUR batch scheduler:', error);
      logInfo('Failed to start CUR batch scheduler (continuing without batch scheduling)', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    app.listen(PORT, () => {
      logInfo(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
