#!/system/bin/sh


MODULE_ZIP="/sdcard/temp_module.zip"
MODULES_DIR="/data/adb/modules"
TEMP_DIR="/data/local/tmp/module_install_$$"

# 检查参数
if [ -z "$MODULE_ZIP" ] || [ ! -f "$MODULE_ZIP" ]; then
    exit 1
fi

# 清理并创建临时目录
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# 解压模块文件
unzip -q "$MODULE_ZIP" -d "$TEMP_DIR"
if [ $? -ne 0 ]; then
    rm -rf "$TEMP_DIR"
    exit 1
fi

# 获取模块 ID
if [ -f "$TEMP_DIR/module.prop" ]; then
    MODULE_ID=$(grep "^id=" "$TEMP_DIR/module.prop" | cut -d= -f2 | tr -d '\r')
fi
if [ -z "$MODULE_ID" ]; then
    MODULE_ID=$(basename "$MODULE_ZIP" .zip)
fi

MODULE_PATH="$MODULES_DIR/$MODULE_ID"

# 设置安装环境变量
export MODPATH="$MODULE_PATH"
export TMPDIR="$TEMP_DIR"
export ZIPFILE="$MODULE_ZIP"
export OUTFD=1
export KSU=false
export MAGISK_VER_CODE=30000
export MAGISK_VER="30.0"

cd "$TEMP_DIR" || cd /

# ============================================
#  安全执行安装脚本（静默，禁用退出命令）
# ============================================
run_script_safely() {
    local script="$1"
    (
        sh -c '
            exit() { return 0; }
            abort() { return 0; }
            return() { return 0; }
            set +e
            set +u
            set +o pipefail 2>/dev/null
            . "$1"
        ' _ "$script" >/dev/null 2>&1
    )
}
echo 正在执行安装脚本，时间可能较长...
if [ -f "$TEMP_DIR/customize.sh" ]; then
    run_script_safely "$TEMP_DIR/customize.sh"
elif [ -f "$TEMP_DIR/install.sh" ]; then
    run_script_safely "$TEMP_DIR/install.sh"
fi

# ============================================
#  强制覆盖模块文件
# ============================================
rm -rf "$MODULE_PATH"
mkdir -p "$MODULE_PATH"

cp -rf "$TEMP_DIR"/* "$MODULE_PATH/"
rm -rf "$MODULE_PATH/META-INF"

if [ ! -f "$MODULE_PATH/module.prop" ]; then
    cat > "$MODULE_PATH/module.prop" <<EOF
id=$MODULE_ID
name=$MODULE_ID
version=1.0
versionCode=1
author=unknown
description=Force installed module
EOF
fi
chmod 644 "$MODULE_PATH/module.prop"

# ============================================
#  设置权限与 SELinux 上下文
# ============================================
chmod -R 755 "$MODULE_PATH/system" 2>/dev/null
chmod -R 755 "$MODULE_PATH/zygisk" 2>/dev/null
chmod -R 755 "$MODULE_PATH/webroot" 2>/dev/null

find "$MODULE_PATH" -name "*.sh" -type f -exec chmod 755 {} \; 2>/dev/null

chown -R 0:0 "$MODULE_PATH"

if command -v chcon >/dev/null 2>&1; then
    chcon -R u:object_r:system_file:s0 "$MODULE_PATH" 2>/dev/null
fi

# ============================================
#  清理临时文件
# ============================================
rm -rf "$TEMP_DIR"

exit 0