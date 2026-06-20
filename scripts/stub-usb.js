// scripts/stub-usb.js - 构建前替换 usb/dist/index.js 为空 stub
// 解决:Rollup 的 commonjs 插件扫描 usb 包 → 读到 .node 二进制 → 崩溃
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'usb', 'dist', 'index.js');
const backup = target + '.bak';

const stub = `module.exports={webusb:{addEventListener(){},removeEventListener(){},getDevices(){return[]}},usb:{addEventListener(){},removeEventListener(){},getDevices(){return[]}}}`;

if (process.argv.includes('--restore')) {
  // 恢复
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, target);
    fs.unlinkSync(backup);
    console.log('[stub-usb] 恢复 usb/dist/index.js');
  }
} else {
  // 替换
  if (fs.existsSync(target) && !fs.existsSync(backup)) {
    fs.copyFileSync(target, backup);
    fs.writeFileSync(target, stub);
    console.log('[stub-usb] 替换 usb/dist/index.js 为 stub');
  }
}
