import { Sequelize } from 'sequelize';
import { getEnvVariable, getEnvVariableWithDefault } from './environment';
import { logInfo, logError } from '../logger';

// =============================================================================
// DATABASE CONNECTION
// =============================================================================

const dbName = getEnvVariable('DB_NAME');
const dbUser = getEnvVariable('DB_USER');
const dbPassword = getEnvVariable('DB_PASSWORD');
const dbHost = getEnvVariable('DB_HOST');
const poolMax = parseInt(getEnvVariableWithDefault('DB_POOL_MAX', '10'), 10);
const poolMin = parseInt(getEnvVariableWithDefault('DB_POOL_MIN', '0'), 10);
const poolAcquire = parseInt(getEnvVariableWithDefault('DB_POOL_ACQUIRE', '30000'), 10);
const poolIdle = parseInt(getEnvVariableWithDefault('DB_POOL_IDLE', '10000'), 10);

const sequelize = new Sequelize(dbName, dbUser, dbPassword, {
  host: dbHost,
  dialect: 'mysql',
  logging: (msg) => logInfo(msg),
  // TODO Auroraに移行するときに要確認(現在はDBをJSTに設定中)
  timezone: '+09:00', // JSTで設定
  dialectOptions: {
    timezone: 'Z', // UTCで保存
  },
  define: {
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at'
  },
  pool: {
    max: poolMax,
    min: poolMin,
    acquire: poolAcquire,
    idle: poolIdle
  }
});

// データベース接続の確認
const checkConnection = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    logInfo('Database connection has been established successfully.');
  } catch (error) {
    logError('Unable to connect to the database:', error);
    throw error;
  }
};

// データベース接続同期
const syncDatabase = async (force: boolean = false): Promise<void> => {
  try {
    await sequelize.sync({ force });
    logInfo('Database synchronized successfully.');
  } catch (error) {
    logError('Unable to sync database:', error);
    throw error;
  }
};

// データベース接続終了
const closeConnection = async (): Promise<void> => {
  try {
    await sequelize.close();
    logInfo('Database connection closed.');
  } catch (error) {
    logError('Error closing database connection:', error);
    throw error;
  }
};

export {
  sequelize,
  checkConnection,
  syncDatabase,
  closeConnection,
};