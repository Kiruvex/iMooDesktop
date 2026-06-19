#!/system/bin/sh

TEMP_FILE="/data/local/tmp/magisk_modules.txt"
MODULES_DIR="/data/adb/modules"

if [ ! -d "$MODULES_DIR" ]; then
    echo "未找到 Magisk 模块目录 ($MODULES_DIR)。"
    exit 1
fi

> "$TEMP_FILE"
MODULE_COUNT=0

for module in "$MODULES_DIR"/*; do
    [ -d "$module" ] || continue
    PROP_FILE="$module/module.prop"
    if [ -f "$PROP_FILE" ]; then
        MODULE_COUNT=$((MODULE_COUNT + 1))
        name=$(grep -m1 "^name=" "$PROP_FILE" | sed 's/^name=//')
        id=$(basename "$module")
        version=$(grep -m1 "^version=" "$PROP_FILE" | sed 's/^version=//')
        versionCode=$(grep -m1 "^versionCode=" "$PROP_FILE" | sed 's/^versionCode=//')
        author=$(grep -m1 "^author=" "$PROP_FILE" | sed 's/^author=//')
        description=$(grep -m1 "^description=" "$PROP_FILE" | sed 's/^description=//')
        updateJson=$(grep -m1 "^updateJson=" "$PROP_FILE" | sed 's/^updateJson=//')


        status="工作中"
        dis_status=""
        rm_status=""
        update_status=""

        if [ -f "$module/disable" ]; then
            dis_status="已禁用"
        fi
        if [ -f "$module/remove" ]; then
            rm_status="已标记卸载"
        fi
        if [ -f "$module/update" ]; then
            update_status="已更新"
        fi


        status="${dis_status}${rm_status}${update_status}"

        [ -z "$status" ] && status="工作中"

        name=${name:-未知}
        version=${version:-未知}
        versionCode=${versionCode:-未知}
        author=${author:-未知}
        description=${description:-无}
        updateJson=${updateJson:-无}

        {
            echo "模块ID: $id"
            echo "名称: $name"
            echo "版本: $version"
            echo "内部版本: $versionCode"
            echo "作者: $author"
            echo "状态: $status"
            echo "描述: $description"
            echo "更新地址: $updateJson"
            echo "========================================"
        }
    fi
done

if [ $MODULE_COUNT -eq 0 ]; then
    echo "未找到任何模块信息。"
    exit 0
fi

echo "共找到 $MODULE_COUNT 个模块。"