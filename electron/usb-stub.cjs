// electron/usb-stub.cjs - usb 包的构建时 stub
//
// 问题:usb 包含 native addon(.node),Vite/Rollup 的 commonjs 插件
// 在构建时会扫描 usb/dist/index.js → require('../index.js') → .node 二进制 → 崩溃
// 即使 external 标记了 usb,commonjs 插件仍然会扫描它提取 named exports
//
// 解决:用 resolve.alias 把 usb 指向这个空 stub,构建时 Rollup 读到的是空模块
// 运行时 require('usb') 不受影响(external 让它保持 require 不打包)
//
// 这个文件只在构建时被 Vite 读取,运行时 Electron 直接 require('usb') 从 node_modules 加载

module.exports = {
  webusb: {
    addEventListener: function () {},
    removeEventListener: function () {},
    getDevices: function () { return []; },
  },
  usb: {
    addEventListener: function () {},
    removeEventListener: function () {},
    getDevices: function () { return []; },
  },
};
