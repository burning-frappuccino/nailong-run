@echo off
rem ============================================================
rem  奶龙跑酷 · 启动器
rem  双击本文件即可用浏览器打开游戏。
rem  纯前端项目，不需要安装任何东西，也不需要联网。
rem ============================================================
setlocal
set "GAME=%~dp0index.html"

if not exist "%GAME%" (
  echo.
  echo   [错误] 找不到 index.html
  echo   请确认本文件与 index.html 在同一个文件夹里。
  echo.
  pause
  exit /b 1
)

rem --- 优先用 Chrome / Edge 打开（动画和音效表现最好）---
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if defined BROWSER (
  start "" "%BROWSER%" "%GAME%"
) else (
  rem 都没找到就用系统默认浏览器
  start "" "%GAME%"
)

exit /b 0
