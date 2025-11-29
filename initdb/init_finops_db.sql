-- FinOpsデータベースの初期化スクリプト
-- このスクリプトはMySQLコンテナの初回起動時に自動実行されます

-- FinOpsデータベースを作成
CREATE DATABASE IF NOT EXISTS rinstack_finops_db;

-- rinstack_userが存在しない場合は作成（既にdocker-compose.yamlで作成されている可能性があるため）
CREATE USER IF NOT EXISTS 'rinstack_user'@'%' IDENTIFIED BY 'rinstack_p@ssw0rd';

-- rinstack_userにrinstack_finops_dbへの全権限を付与
GRANT ALL PRIVILEGES ON rinstack_finops_db.* TO 'rinstack_user'@'%';

-- 権限を反映
FLUSH PRIVILEGES;

