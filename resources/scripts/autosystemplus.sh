#!/system/bin/sh
EDXP_MANAGER="com.solohsu.android.edxp.manager"
# 要激活的模块包名列表
PACKAGES="com.coderstory.toolkit com.huanli233.systemplus"

# 检查所有模块是否已安装
for pkg in $PACKAGES; do
    if ! pm path "$pkg" >/dev/null 2>&1; then
        echo "应用未安装: $pkg"
        exit 1
    fi
done

get_app_uid() {
    local pkg_name="$1"
    dumpsys package $pkg_name | grep userId= | sed 's/.*userId=\([0-9]*\).*/\1/'
}

am force-stop "$EDXP_MANAGER"
killall "$EDXP_MANAGER" 2>/dev/null

XML_FILE="/data/data/$EDXP_MANAGER/shared_prefs/enabled_modules.xml"
mkdir -p "$(dirname "$XML_FILE")"

if [ ! -f "$XML_FILE" ]; then
    echo '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>' > "$XML_FILE"
    echo '<map>' >> "$XML_FILE"
    echo '</map>' >> "$XML_FILE"
fi

# 将每个模块添加到启用列表
for pkg in $PACKAGES; do
    if ! grep -q "<int name=\"$pkg\" value=\"1\" />" "$XML_FILE"; then
        sed -i "s/<\/map>//" "$XML_FILE"
        echo "    <int name=\"$pkg\" value=\"1\" />" >> "$XML_FILE"
        echo "</map>" >> "$XML_FILE"
    fi
done

mkdir -p "/data/user_de/0/$EDXP_MANAGER/conf/"

sed -n 's/.*<int name="\([^"]*\)" value="1" \/>.*/\1/p' "$XML_FILE" > "/data/user_de/0/$EDXP_MANAGER/conf/enabled_modules.list"

echo "" > "/data/user_de/0/$EDXP_MANAGER/conf/modules.list.tmp"
while read -r module; do
    apk_path=$(pm path "$module" | head -n 1 | cut -d: -f2)
    if [ -n "$apk_path" ]; then
        echo "$apk_path" >> "/data/user_de/0/$EDXP_MANAGER/conf/modules.list.tmp"
    fi
done < "/data/user_de/0/$EDXP_MANAGER/conf/enabled_modules.list"

mv "/data/user_de/0/$EDXP_MANAGER/conf/modules.list.tmp" "/data/user_de/0/$EDXP_MANAGER/conf/modules.list"

EDXP_UID=$(get_app_uid "$EDXP_MANAGER")
if [ -n "$EDXP_UID" ]; then
    chown $EDXP_UID:$EDXP_UID "$XML_FILE"
    chown $EDXP_UID:$EDXP_UID "/data/user_de/0/$EDXP_MANAGER/conf/enabled_modules.list"
    chown $EDXP_UID:$EDXP_UID "/data/user_de/0/$EDXP_MANAGER/conf/modules.list"
fi