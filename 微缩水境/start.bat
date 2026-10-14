@echo off
chcp 65001 >nul
title 微缩水境 · Aquascape 本地服务器
cd /d "%~dp0"

echo.
echo  ==========================================
echo    微缩水境 · Aquascape  生态模拟 Demo
echo  ==========================================
echo.
echo    浏览器地址: http://127.0.0.1:8899/
echo    关闭本窗口即停止服务器
echo.

rem 2 秒后自动打开浏览器
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8899/"

rem 优先使用 Python，其次 Node
where python >nul 2>nul
if %errorlevel%==0 (
  echo    [使用 Python 启动]
  python -m http.server 8899
  goto :end
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo    [使用 Node 启动]
  node server.js 8899
  goto :end
)

echo  [错误] 未检测到 Python 或 Node.js，请先安装其中之一。
echo  Node.js 下载: https://nodejs.org/
pause

:end
