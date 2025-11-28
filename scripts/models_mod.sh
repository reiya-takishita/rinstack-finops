#!/bin/sh

for file in `find ./src/models -type f -name "*.ts"`; do
  # createdByフィールドが存在する場合のみ、その前にcreatedAtを追加
  if grep -q 'createdBy: {' "$file"; then
    if ! grep -q 'createdAt: {' "$file"; then
      sed -i '/createdBy: {/i\
    createdAt: {\n      type: DataTypes.DATE,\n      field: '\''created_at'\''\n    },\
  ' "$file"
      echo "createdAt field added to $file."
    fi
  fi
  
  # updatedByフィールドが存在する場合のみ、その前にupdatedAtを追加
  if grep -q 'updatedBy: {' "$file"; then
  if ! grep -q 'updatedAt: {' "$file"; then
    sed -i '/updatedBy: {/i\
      updatedAt: {\n      type: DataTypes.DATE,\n      field: '\''updated_at'\''\n    },\
    ' "$file"
    echo "updatedAt field added to $file."
  fi
  fi

  # deletedByフィールドが存在する場合のみ、その前にdeletedAtを追加
  if grep -q 'deletedBy: {' "$file"; then
    if ! grep -q 'deletedAt: {' "$file"; then
      sed -i '/deletedBy: {/i\
      deletedAt: {\n      type: DataTypes.DATE,\n      field: '\''deleted_at'\''\n    },\
    ' "$file"
      echo "deletedAt field added to $file."
    fi
  fi

  # indexesの前にdefaultScopeを追加
  created_at_exclude=""
  updated_at_exclude=""
  deleted_at_exclude=""

  # Check if createdAt field is defined
  if grep -q 'createdAt: {' "$file"; then
    created_at_exclude="'created_at'"
  fi
  # Check if updatedAt field is defined
  if grep -q 'updatedAt: {' "$file"; then
    updated_at_exclude="'updated_at'"
  fi
  # Check if deletedAt field is defined
  if grep -q 'deletedAt: {' "$file"; then
    deleted_at_exclude="'deleted_at'"
  fi

  # 絞り込み: ひとつでも設定されていればexclude配列を組み立てる
  exclude_list=""
  if [ -n "$created_at_exclude" ]; then
    exclude_list="$created_at_exclude"
  fi
  if [ -n "$updated_at_exclude" ]; then
    if [ -n "$exclude_list" ]; then
      exclude_list="$exclude_list, $updated_at_exclude"
    else
      exclude_list="$updated_at_exclude"
    fi
  fi
  if [ -n "$deleted_at_exclude" ]; then
    if [ -n "$exclude_list" ]; then
      exclude_list="$exclude_list, $deleted_at_exclude"
    else
      exclude_list="$deleted_at_exclude"
    fi
  fi

  # defaultScopeを動的に追加（排他するカラムが1つ以上ある場合のみ実行）
  if [ -n "$exclude_list" ]; then
    if ! grep -q "defaultScope: {" "$file"; then
      # indexesの前にdefaultScope（exclude_listは内容に応じて動的に組み立てられる）
      sed -i "/indexes:\s*\[/i\
    defaultScope: {\
      attributes: { exclude: [${exclude_list}] },\
    },\
" "$file"
      echo "defaultScope processed for $file."
    fi
  fi

  # 前の行で "extends Model<" を含むなら、"static initModel"まで "declare " を加える
  # さらに declare 対象行に "!:" があれば ":" に置き換える
  awk '
    /extends Model</ {
      in_block = 1
      print
      next
    }

    in_block {
      # 空行は declare を付けずそのまま出力（block は継続）
      if ($0 ~ /^$/) {
        print
        next
      }

      # コメント行（// ...）も declare 対象外（block 継続）
      if ($0 ~ /^[[:space:]]*\/\//) {
        print
        next
      }

      # static initModel が来たら block 終了
      if ($0 ~ /static[[:space:]]+initModel/) {
        in_block = 0
        print
        next
      }

      line = $0

      # "!:" があれば ":" に変換
      gsub(/!:/, ":", line)

      print "declare " line
      next
    }

    # 通常行
    {
      print
    }
  ' "$file" > "${file}.tmp"

  mv "${file}.tmp" "$file"
done

echo "All files processed."