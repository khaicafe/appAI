@echo off
setlocal

cd /d "%~dp0"
set "DEFAULT_CERT_FILE=%CD%\resources\certs\openclaw-controller-selfsigned.pfx"
set "DEFAULT_CERT_PASSWORD=123456"

net session >nul 2>&1
if errorlevel 1 (
  echo Yeu cau quyen Administrator de build signed tren Windows.
  echo Dang mo lai script voi quyen cao hon...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -Verb RunAs -WorkingDirectory '%CD%' -FilePath 'cmd.exe' -ArgumentList '/c','call ""%~f0""'"
  exit /b 0
)

set "WIN_CERT_FILE=%~1"
set "WIN_CERT_PASSWORD=%~2"

if not defined WIN_CERT_FILE (
  if exist "%DEFAULT_CERT_FILE%" (
    set "WIN_CERT_FILE=%DEFAULT_CERT_FILE%"
    echo Su dung certificate mac dinh trong project: "%WIN_CERT_FILE%"
  ) else (
    set /p WIN_CERT_FILE=Nhap duong dan toi file .pfx: 
  )
)

if not defined WIN_CERT_PASSWORD (
  if /I "%WIN_CERT_FILE%"=="%DEFAULT_CERT_FILE%" (
    set "WIN_CERT_PASSWORD=%DEFAULT_CERT_PASSWORD%"
    echo Su dung mat khau mac dinh cua cert test trong project.
  ) else (
    set /p WIN_CERT_PASSWORD=Nhap mat khau certificate: 
  )
)

if not defined WIN_CERT_FILE (
  echo Thieu duong dan file certificate .pfx.
  exit /b 1
)

if not defined WIN_CERT_PASSWORD (
  echo Thieu mat khau certificate.
  exit /b 1
)

if not exist "%WIN_CERT_FILE%" (
  echo Khong tim thay file certificate: "%WIN_CERT_FILE%"
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo Khong tim thay npm.cmd trong PATH. Hay mo terminal co Node.js/npm truoc.
  exit /b 1
)

set "CSC_LINK=%WIN_CERT_FILE%"
set "CSC_KEY_PASSWORD=%WIN_CERT_PASSWORD%"

echo ========================================
echo Dang build Windows signed installer...
echo Certificate: %WIN_CERT_FILE%
echo Thu muc du an: %CD%
echo ========================================

call npm run dist:win:signed
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo Build signed that bai voi ma loi %EXIT_CODE%.
  echo Neu loi nhac toi winCodeSign hoac symbolic link, hay bat Windows Developer Mode.
  exit /b %EXIT_CODE%
)

echo Build signed thanh cong. Kiem tra thu muc release\
if exist "%CD%\release" start "" "%CD%\release"
exit /b 0