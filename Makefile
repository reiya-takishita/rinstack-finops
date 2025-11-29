# Makefile

.PHONY: up down up-cognitomock down-cognitomock migrate migrate-undo seed seed-undo auto-models update-models gen-audit-artifacts codemod-audit-models gen-baseline snapshot-schema

# Docker Compose commands for the main application
up:
	docker-compose up -d

down:
	docker-compose down

# Sequelize commands
migrate:
	docker-compose exec app npx sequelize-cli db:migrate

migrate-undo:
	docker-compose exec app npx sequelize-cli db:migrate:undo:all

seed:
	docker-compose exec app npx sequelize db:seed:all

seed-undo:
	docker-compose exec app npx sequelize-cli db:seed:undo:all

# Sequelize-Auto command to generate models
auto-models:
	docker-compose exec app npx sequelize-auto -h mysql -d rinstack_finops_db -u rinstack_user -x rinstack_p@ssw0rd -p 3306 --dialect mysql -c ./config/config.json -o ./src/models -l ts --caseProp c --singularize
mod-models:
	docker-compose run --rm app sh -c 'sh scripts/models_mod.sh'
create-models: auto-models mod-models

# ベースラインマイグレーション自動生成（現行DBスキーマ→migrations/ に出力）
gen-baseline:
	docker-compose exec app node scripts/generate_baseline_migrations.js

# 現行DBスキーマのスナップショットを出力（schema_snapshots/<timestamp>/）
snapshot-schema:
	docker-compose exec app node scripts/export_schema_snapshot.js

# Seed内容の全テーブルダンプ（比較用）。必要に応じて --env を変更してください。
dump-seed:
	docker-compose exec app node scripts/export_seed_data.js --env development

# Include local deployment commands if exists
-include Makefile.local.mk