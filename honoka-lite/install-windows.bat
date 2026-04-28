@echo off
chcp 65001 >nul
echo 正在安裝與更新 Honoka Chrome Extension 與 Bridge 伺服器...

set "BASE_DIR=%~dp0"
set "BASE_DIR=%BASE_DIR:~0,-1%"
set "BRIDGE_DIR=%BASE_DIR%\honoka-bridge"

:: ======== 1. 檢查 Node.js ========
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Node.js！請先安裝 Node.js。
    pause
    exit /b 1
)

:: ======== 2. 安裝 Honoka Bridge 伺服器 ========
echo [1/2] 設定 Honoka Bridge 背景執行...
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_FILE=%STARTUP_FOLDER%\honoka-bridge.vbs"

:: 關閉舊版程序
WMIC PROCESS WHERE "Name='node.exe' AND CommandLine LIKE '%%honoka-bridge%%'" CALL Terminate >nul 2>nul
timeout /t 1 /nobreak >nul

:: 建立背景執行 VBS
echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_FILE%"
echo WshShell.Environment("Process").Item("HONOKA_PORT") = "7749" >> "%VBS_FILE%"
echo WshShell.Environment("Process").Item("HONOKA_EDITOR") = "cursor" >> "%VBS_FILE%"
echo WshShell.Run "node """ ^& "%BRIDGE_DIR%\index.js" ^& """", 0, False >> "%VBS_FILE%"

:: 立即啟動新版 Bridge
cscript //nologo "%VBS_FILE%"

:: ======== 3. 安裝 Chrome 擴充功能 ========
echo [2/2] 登錄 Chrome 擴充功能...
set EXT_ID=pmcgaidpdpelalcjmagljeemgklhooog
set CRX_NAME=honoka.crx
set CRX_VERSION=0.48.7
set "CRX_PATH=%BASE_DIR%\%CRX_NAME%"

if exist "%CRX_PATH%" (
    REG ADD "HKCU\Software\Google\Chrome\Extensions\%EXT_ID%" /v "path" /t REG_SZ /d "%CRX_PATH%" /f >nul
    REG ADD "HKCU\Software\Google\Chrome\Extensions\%EXT_ID%" /v "version" /t REG_SZ /d "%CRX_VERSION%" /f >nul
    echo ✓ 擴充功能已成功登錄到 Windows Registry。
) else (
    echo [警告] 找不到 %CRX_NAME%，請確認你已經將擴充功能打包為 %CRX_NAME% 並放在同一個資料夾下。
    echo (擴充功能註冊已略過，但 Bridge 伺服器已正常啟動)
)

echo.
echo ==============================================
echo 安裝完成！
echo 1. Bridge 伺服器已在背景執行，開機也會自動啟動。
echo 2. 請重新啟動 Google Chrome 瀏覽器。
echo ==============================================
pause
