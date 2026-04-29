# Warehouse POS — 개발자 PC 설치 가이드

> 서버 설치(SERVER_INSTALL.md)와 달리, **개발 PC에서는 PM2 없이** 백엔드와 프론트엔드를 각각 실행합니다.

---

## 사전 준비물

| 항목 | 버전 | 비고 |
|------|------|------|
| Node.js | v18 LTS 이상 | https://nodejs.org |
| MariaDB | 11.x 이상 | https://mariadb.org/download |
| Git | 최신 | https://git-scm.com |
| VS Code | 최신 | 권장 에디터 |

---

## Step 1 — Node.js 설치

1. https://nodejs.org 에서 **LTS** 버전 다운로드 후 설치
2. 설치 확인:

```cmd
node --version
npm --version
```

---

## Step 2 — MariaDB 설치

1. https://mariadb.org/download 에서 Windows 설치 파일(`.msi`) 다운로드
2. 설치 시 **Root password** 설정 (반드시 기억)
3. 설치 완료 후 서비스 실행 확인:

```cmd
sc query mariadb
```

> `RUNNING` 상태이면 정상

---

## Step 3 — 소스 코드 받기

```cmd
git clone <저장소 URL> C:\dev\warehouse-pos
cd C:\dev\warehouse-pos
```

> 저장소가 없는 경우 프로젝트 폴더를 직접 복사해도 됩니다.

---

## Step 4 — 백엔드 환경 설정 (.env)

`backend\` 폴더 안에 `.env` 파일을 생성합니다.  
`.env.example` 을 복사해서 시작하면 편합니다:

```cmd
copy backend\.env.example backend\.env
```

그 다음 `backend\.env` 를 열어 수정:

```dotenv
NODE_ENV=development
PORT=5000

# MariaDB 접속 정보 (본인 PC 기준)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=warehouse_pos
DB_USER=root
DB_PASSWORD=여기에_MariaDB_비밀번호_입력

# JWT 비밀키 (개발용은 아무 문자열이나 가능)
JWT_SECRET=dev_secret_key_1234

# 초기 관리자 계정
ADMIN_EMAIL=admin@warehouse.local
ADMIN_PASSWORD=Admin1234!
ADMIN_NAME=관리자

APP_MODE=developer
```

---

## Step 5 — 데이터베이스 생성

MariaDB에 접속해서 데이터베이스를 만듭니다:

```cmd
mysql -u root -p
```

```sql
CREATE DATABASE warehouse_pos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

---

## Step 6 — 패키지 설치

백엔드와 프론트엔드 각각 설치합니다:

```cmd
cd C:\dev\warehouse-pos\backend
npm install

cd ..\frontend
npm install
```

---

## Step 7 — 서버 실행

### 방법 A — 한번에 실행 (start.bat)

프로젝트 루트에서 `start.bat` 를 더블클릭하거나:

```cmd
cd C:\dev\warehouse-pos
start.bat
```

백엔드(5000포트)와 프론트엔드(3000포트)가 각각 별도 창에서 실행되고, 브라우저가 자동으로 열립니다.

---

### 방법 B — 각각 따로 실행 (VS Code 터미널 권장)

**터미널 1 — 백엔드:**

```cmd
cd backend
npm run dev
```

**터미널 2 — 프론트엔드:**

```cmd
cd frontend
npm start
```

> `npm run dev` 는 nodemon을 사용하므로 코드 수정 시 서버가 자동으로 재시작됩니다.

---

## Step 8 — 관리자 계정 초기화

최초 1회만 실행합니다. 백엔드 서버를 먼저 한 번 기동해서 테이블이 생성된 후 실행하세요:

```cmd
cd installer
node setup-db.js
```

---

## 접속 확인

| 주소 | 설명 |
|------|------|
| `http://localhost:3000` | React 개발 서버 (핫리로드 지원) |
| `http://localhost:5000/api` | 백엔드 API |

로그인:
- 이메일: `.env` 의 `ADMIN_EMAIL` 값
- 비밀번호: `.env` 의 `ADMIN_PASSWORD` 값

---

## 개발 중 자주 쓰는 명령어

```cmd
:: 백엔드 (nodemon — 코드 저장 시 자동 재시작)
cd backend && npm run dev

:: 프론트엔드 (React 개발 서버 — 핫리로드)
cd frontend && npm start

:: 프론트엔드 프로덕션 빌드 (배포용)
cd frontend && npm run build

:: 인스톨러 EXE 빌드 (Inno Setup 필요)
build-installer.bat
```

---

## 폴더 구조

```
warehouse-pos\
├── backend\            ← Node.js 서버
│   ├── server.js       ← 진입점
│   ├── routes\         ← API 라우터
│   ├── models\         ← Sequelize 모델
│   ├── config\         ← DB 설정
│   ├── services\       ← 비즈니스 로직
│   ├── uploads\        ← 업로드 파일 (git 제외)
│   └── .env            ← 환경 변수 (git 제외)
├── frontend\           ← React 앱
│   ├── src\
│   │   ├── App.js
│   │   ├── api\api.js  ← API 통신
│   │   └── components\
│   └── build\          ← 빌드 결과물 (npm run build 후 생성)
├── installer\          ← 인스톨러 빌드 스크립트
├── dev-tools\          ← 개발 전용 도구
├── start.bat           ← 개발 서버 한번에 실행
└── build-installer.bat ← EXE 인스톨러 빌드
```

---

## 문제 해결

### `npm run dev` 실행 시 DB 연결 오류
- `.env` 의 `DB_PASSWORD` 확인
- MariaDB 서비스 실행 여부 확인: `sc query mariadb`

### 프론트엔드에서 API 요청 실패 (CORS 오류)
- 백엔드가 `5000` 포트에서 실행 중인지 확인
- `frontend\src\api\api.js` 의 서버 URL 설정 확인

### `npm install` 후 `node-gyp` 오류
- Python 및 Visual Studio Build Tools 설치 필요:
  ```cmd
  npm install -g windows-build-tools
  ```

### 포트 이미 사용 중 오류
```cmd
:: 5000 포트 사용 중인 프로세스 확인
netstat -ano | findstr :5000
:: PID 로 종료
taskkill /PID <PID번호> /F
```
