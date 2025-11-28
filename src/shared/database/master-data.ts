import { logInfo, logError } from '../logger';

// =============================================================================
// MASTER DATA MANAGEMENT
// =============================================================================

export interface MasterData {
}

// マスタデータを取得用設定
export const getMasterData = async (): Promise<MasterData> => {
  logInfo('<<< Start fetching all data from masters table. >>>');
  try {
    logInfo('<<< Finish fetching all data from masters table. >>>');
    return {
    };
  } catch (error) {
    logError('<<< Error fetching master data with categoryCode. >>>');
    throw error;
  }
};

let masterData: MasterData | null = null;

// 初期化関数
export const initializeMasterData = async (): Promise<void> => {
  logInfo('<<< Start initializing master data. >>>');
  try {
    if (!masterData) {
      masterData = await getMasterData();
    }
    logInfo('<<< Finish initializing master data. >>>');
  } catch (error) {
    logError('<<< Initialize Error. >>>');
    throw error;
  }
};

// マスタデータのリロード関数
export const reloadMasterData = async (): Promise<void> => {
  logInfo('<<< Start reloading master data. >>>');
  try {
    masterData = await getMasterData();
    logInfo('<<< Finish reloading master data. >>>');
  } catch (error) {
    logError('<<< Error to reload master data. >>>');
    throw error;
  }
};