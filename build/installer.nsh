; build/installer.nsh - NSIS 自定义脚本
; 在安装/卸载前强制关闭运行中的 iMooDesktop 实例
;
; 解决问题:oneClick:false 模式下升级安装时,旧进程占用 exe 导致
;           NSIS 写文件失败,弹出"无法写入文件,重试/取消"警告框
;
; 机制:electron-builder 生成的 NSIS 脚本会 !include build/installer.nsh
;       并在对应位置调用这些宏:
;         customInit      → .onInit 阶段(文件解压前,最适合 kill 进程)
;         customUnInit    → un.onInit 阶段(卸载文件前)
;
; 参考:https://www.electron.build/configuration/nsis#custom-nsis-script

; ---- 安装前:关闭运行中的 iMooDesktop(避免写 exe 时被占用) ----
!macro customInstall
  ; customInstall 在文件解压后执行,此时 exe 可能已被占用导致解压失败
  ; 真正的 kill 放在 customInit(.onInit) 里
!macroend

!macro customInit
  ; .onInit 阶段:安装器刚启动,还没写任何文件
  ; taskkill /F 强制结束,/IM 按映像名匹配,忽略"进程不存在"错误
  nsExec::ExecToLog 'taskkill /F /IM iMooDesktop.exe'
  Pop $0
  ; 给进程一点时间真正退出,避免文件句柄未释放
  Sleep 500
!macroend

; ---- 卸载前:同样关闭实例 ----
!macro customUnInstall
!macroend

!macro customUnInit
  nsExec::ExecToLog 'taskkill /F /IM iMooDesktop.exe'
  Pop $0
  Sleep 500
!macroend
