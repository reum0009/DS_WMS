@echo off
setlocal enabledelayedexpansion
title Warehouse POS - 업데이트 파일 생성

echo.
echo ============================================================
echo  Warehouse POS - 업데이트 ZIP 생성
echo ============================================================
echo.

set /p VERSION="업데이트 버전 입력 (예: 1.0.1): "
if "%VERSION%"=="" (
  echo [오류] 버전이 비어 있습니다.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [오류] Node.js 가 설치되어 있지 않습니다.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js !NODE_VER!

if not exist "%~dp0updates" mkdir "%~dp0updates"
if not exist "%~dp0releases" mkdir "%~dp0releases"

if not exist "%~dp0dev-tools\node_modules\archiver" (
  echo.
  echo [1/4] dev-tools 의존성 설치 중...
  pushd "%~dp0dev-tools"
  call npm install --silent
  if errorlevel 1 (
    echo [오류] dev-tools npm install 실패
    popd
    pause
    exit /b 1
  )
  popd
) else (
  echo [1/4] dev-tools 의존성 확인 완료
)

set /p DO_BUILD="프론트엔드 빌드 실행? (Y/n): "
if /i "%DO_BUILD%"=="n" (
  echo [2/4] 프론트엔드 빌드 생략
) else (
  echo.
  echo [2/4] 프론트엔드 빌드 중...
  pushd "%~dp0frontend"
  call npm run build
  if errorlevel 1 (
    echo [오류] 프론트엔드 빌드 실패
    popd
    pause
    exit /b 1
  )
  popd
)

echo.
echo [3/4] 업데이트 ZIP 생성 중...
node "%~dp0installer\build-package.js" %VERSION%
if errorlevel 1 (
  echo [오류] 업데이트 ZIP 생성 실패
  pause
  exit /b 1
)

if not exist "%~dp0installer\app.zip" (
  echo [오류] installer\app.zip 파일을 찾을 수 없습니다.
  pause
  exit /b 1
)

set ZIP_NAME=release-v%VERSION%.zip
copy /Y "%~dp0installer\app.zip" "%~dp0releases\%ZIP_NAME%" >nul
if errorlevel 1 (
  echo [오류] releases 폴더 복사 실패
  pause
  exit /b 1
)

copy /Y "%~dp0installer\app.zip" "%~dp0updates\%ZIP_NAME%" >nul
if errorlevel 1 (
  echo [오류] updates 폴더 복사 실패
  pause
  exit /b 1
)

echo [4/4] 배치 완료
echo.
echo ============================================================
echo  완료:
echo   - releases\%ZIP_NAME%
echo   - updates\%ZIP_NAME%
echo ============================================================
echo.

pause
endlocal
