@echo off
setlocal enabledelayedexpansion
title Warehouse POS - 인스톨러 빌드

echo.
echo ============================================================
echo  Warehouse POS - EXE 인스톨러 빌드
echo ============================================================
echo.

:: ── 버전 입력 ────────────────────────────────────────────────
set /p VERSION="빌드할 버전 입력 (예: 1.0.1, 엔터=현재 유지): "

:: ── Node.js 체크 ─────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo [오류] Node.js 가 설치되어 있지 않습니다.
  echo        https://nodejs.org 에서 LTS 버전을 설치하세요.
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

:: ── Inno Setup 경로 탐색 ─────────────────────────────────────
set ISCC=
for %%p in (
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
  "C:\Program Files\Inno Setup 6\ISCC.exe"
  "C:\Program Files (x86)\Inno Setup 5\ISCC.exe"
  "C:\Program Files\Inno Setup 5\ISCC.exe"
) do (
  if exist %%p set ISCC=%%p
)

if "!ISCC!"=="" (
  echo [오류] Inno Setup 을 찾을 수 없습니다.
  echo        https://jrsoftware.org/isinfo.php 에서 설치하세요.
  pause & exit /b 1
)
echo [OK] Inno Setup: !ISCC!

:: ── dev-tools 의존성 확인 ─────────────────────────────────────
if not exist "%~dp0dev-tools\node_modules\archiver" (
  echo.
  echo [1/4] dev-tools 패키지 설치 중...
  pushd "%~dp0dev-tools"
  call npm install --silent
  if errorlevel 1 ( echo [오류] npm install 실패 & popd & pause & exit /b 1 )
  popd
  echo       완료
) else (
  echo [1/4] dev-tools 패키지 확인 완료
)

:: ── React 프론트엔드 빌드 ─────────────────────────────────────
echo.
echo [2/4] 프론트엔드 빌드 중... (시간이 걸릴 수 있습니다)
pushd "%~dp0frontend"
call npm run build
if errorlevel 1 ( echo [오류] 프론트엔드 빌드 실패 & popd & pause & exit /b 1 )
popd
echo       완료

:: ── app.zip 생성 ─────────────────────────────────────────────
echo.
echo [3/4] app.zip 패키징 중...
if "!VERSION!"=="" (
  node "%~dp0installer\build-package.js"
) else (
  node "%~dp0installer\build-package.js" !VERSION!
)
if errorlevel 1 ( echo [오류] app.zip 생성 실패 & pause & exit /b 1 )

:: MSI 파일 존재 확인
if not exist "%~dp0node-v24.14.1-x64.msi" (
  echo.
  echo [주의] node-v24.14.1-x64.msi 파일이 프로젝트 루트에 없습니다.
  echo        대상 PC에 Node.js 가 없으면 설치가 실패합니다.
)
if not exist "%~dp0mariadb-11.8.6-winx64.msi" (
  echo [주의] mariadb-11.8.6-winx64.msi 파일이 프로젝트 루트에 없습니다.
)

:: ── Inno Setup 컴파일 ─────────────────────────────────────────
echo.
echo [4/4] EXE 컴파일 중...
!ISCC! "%~dp0installer\installer.iss"
if errorlevel 1 ( echo [오류] Inno Setup 컴파일 실패 & pause & exit /b 1 )

:: ── 완료 ─────────────────────────────────────────────────────
echo.
echo ============================================================
echo  빌드 완료!
echo  출력: releases\WarehousePOS_Setup_*.exe
echo ============================================================
echo.

:: 결과 폴더 열기
explorer "%~dp0releases"

pause
endlocal
