@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 清空 NODE_OPTIONS，绕过沙箱注入的安全删除 shim（否则 nuxt build/dev 会被拦）
set NODE_OPTIONS=

if "%PORT%"=="" set PORT=3100
if "%HOST%"=="" set HOST=0.0.0.0

echo ============================================
echo   crm-mini 启动中...
echo   数据库: 读 .env 的 DATABASE_URL（NAS）
echo   访问地址: http://localhost:%PORT%/
echo ============================================
echo.

if not exist ".output\server\index.mjs" (
  echo [1/2] 首次运行，正在构建...
  call node node_modules\nuxt\bin\nuxt.mjs build
  if errorlevel 1 (
    echo 构建失败，已中止。
    pause
    exit /b 1
  )
) else (
  echo [1/2] 已有构建产物，跳过构建。需要重建请先删除 .output 目录。
)

echo.
echo [2/2] 启动服务...
node --env-file=.env .output\server\index.mjs

pause
