#!/system/bin/sh

BUSYBOX="/data/adb/magisk/busybox"
UTIL_FUNCTIONS="/data/adb/magisk/util_functions.sh"
ZIPFILE="/sdcard/temp_module.zip"
export OUTFD=1
export ZIPFILE
export ASH_STANDALONE=1
errorexit() {
    exit 1
}

[ -f "$BUSYBOX" ] || errorexit

chmod 777 "$BUSYBOX" || errorexit

[ -f "$UTIL_FUNCTIONS" ] || errorexit

[ -f "$ZIPFILE" ] || errorexit

"$BUSYBOX" sh -c ". \"$UTIL_FUNCTIONS\"; install_module" || errorexit

exit 0