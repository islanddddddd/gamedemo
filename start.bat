@echo off
chcp 65001 >nul
cd /d %~dp0
echo 正在启动游戏中枢……
if not exist "%~dp0hub-server.js" (
  echo 错误：未找到 hub-server.js
  pause
  exit /b 1
)
node hub-server.js
pause
