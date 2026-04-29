# Warehouse POS — 서버 설치 가이드

> **대상 환경:** Windows Server 2016 이상 / Windows 10 이상 (64bit)

---

## 사전 준비물 체크리스트

| 항목 | 버전 | 비고 |
|------|------|------|
| Node.js | v24 LTS 이상 | https://nodejs.org |
| MariaDB | 11.x 이상 | https://mariadb.org/download |
| PM2 | 최신 | `npm install -g pm2` |

---

## Step 1 — Node.js 설치

1. https://nodejs.org 에서 **LTS** 버전 다운로드 후 설치
2. 설치 완료 후 **명령 프롬프트(cmd)** 를 **관리자 권한**으로 열고 확인:

```cmd
node --version
npm --version
```

> `v24.x.x` 형태로 출력되면 정상

---

## Step 2 — MariaDB 설치

1. https://mariadb.org/download 에서 Windows 설치 파일(`.msi`) 다운로드
2. 설치 마법사 실행
   - **Root password** 설정 (반드시 기억)
   - **Install as service** 체크 (자동 시작)
   - 포트: `3306` (기본값 유지 권장)
3. 설치 완료 후 서비스 확인:

```cmd
sc query mariadb
```

> `RUNNING` 상태이면 정상

---

## Step 3 — 프로젝트 파일 배치

1. 배포된 `app.zip` 파일을 서버에 복사
2. 원하는 경로에 압축 해제 (예: `C:\WarehousePOS`)

```
C:\WarehousePOS\
├── backend\
│   ├── server.js
│   ├── routes\
│   ├── models\
│   └── ...
├── frontend\
│   └── build\
└── installer\
    └── setup-db.js
```

---

## Step 4 — 환경 설정 (.env)

`backend\` 폴더 안에 `.env` 파일을 생성합니다.

```cmd
notepad C:\WarehousePOS\backend\.env
```

아래 내용을 입력하고 **본인 환경에 맞게 수정**:

```dotenv
NODE_ENV=production
PORT=5000

# MariaDB 접속 정보
DB_HOST=localhost
DB_PORT=3306
DB_NAME=warehouse_pos
DB_USER=root
DB_PASSWORD=여기에_MariaDB_비밀번호_입력

# JWT 비밀키 (임의의 긴 문자열로 변경)
JWT_SECRET=change_this_to_a_random_long_string_12345

# 초기 관리자 계정
ADMIN_EMAIL=admin@warehouse.local
ADMIN_PASSWORD=Admin1234!
ADMIN_NAME=관리자

APP_MODE=production
```

> **주의:** `.env` 파일은 외부에 노출되지 않도록 관리하세요.

---

## Step 5 — 데이터베이스 생성

MariaDB에 데이터베이스를 생성합니다.

**방법 A — MariaDB 콘솔 사용:**

```cmd
mysql -u root -p
```

```sql
CREATE DATABASE warehouse_pos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

**방법 B — 스크립트 사용 (Step 6 이후에 실행 가능):**

```cmd
cd C:\WarehousePOS\installer
node setup-db.js
```

---

## Step 6 — npm 패키지 설치

```cmd
cd C:\WarehousePOS\backend
npm install --omit=dev
```

> 수 분 소요될 수 있습니다. 오류 없이 완료되면 다음 단계로 진행합니다.

---

## Step 7 — 서버 최초 기동 (테이블 자동 생성)

Sequelize가 최초 기동 시 테이블을 자동으로 생성합니다.

```cmd
cd C:\WarehousePOS\backend
node server.js
```

콘솔에 아래 메시지가 출력되면 정상:

```
MariaDB connection established
Server running on port 5000
```

`Ctrl+C` 로 중지합니다.

---

## Step 8 — 관리자 계정 초기화

테이블이 생성된 후 관리자 계정을 등록합니다:

```cmd
cd C:\WarehousePOS\installer
node setup-db.js
```

출력 예시:
```
[1/4] MySQL 연결 중...
[2/4] 데이터베이스 'warehouse_pos' 준비 완료
[3/4] 테이블 동기화 중...
[4/4] 관리자 계정 생성 중...
  → 관리자 계정: admin@warehouse.local / Admin1234!
설치 완료! 서버를 시작하세요.
```

---

## Step 9 — PM2 설정 (서비스 자동 시작)

### PM2 전역 설치

```cmd
npm install -g pm2 pm2-windows-startup
```

### PM2 설정 파일 작성

`C:\WarehousePOS\installer\pm2.config.js` 파일을 열어 `cwd` 경로를 실제 경로로 수정:

```js
module.exports = {
  apps: [{
    name: 'warehouse-pos',
    script: 'server.js',
    cwd: 'C:/WarehousePOS/backend',   // ← 실제 경로로 수정 (슬래시 사용)
    env: { NODE_ENV: 'production' },
    restart_delay: 3000,
    max_restarts: 10,
    watch: false,
  }],
};
```

### PM2로 앱 시작

```cmd
cd C:\WarehousePOS\installer
pm2 start pm2.config.js
pm2 save
```

### 윈도우 서비스 등록 (서버 재시작 후 자동 시작)

```cmd
pm2-startup install
```

---

## Step 10 — 방화벽 포트 열기

서버 외부에서 접속하려면 방화벽에서 포트를 허용해야 합니다.

**Windows 방화벽:**

```cmd
netsh advfirewall firewall add rule name="WarehousePOS" dir=in action=allow protocol=TCP localport=5000
```

또는 **제어판 → Windows Defender 방화벽 → 인바운드 규칙 → 새 규칙 → 포트 5000** 에서 설정.

---

## 접속 확인

브라우저에서 아래 주소로 접속:

- **같은 PC:** `http://localhost:5000`
- **네트워크 내 다른 PC:** `http://서버IP주소:5000`

로그인:
- 이메일: `.env`의 `ADMIN_EMAIL` 값
- 비밀번호: `.env`의 `ADMIN_PASSWORD` 값

---

## PM2 관리 명령어

```cmd
pm2 list                    # 실행 중인 프로세스 목록
pm2 logs warehouse-pos      # 실시간 로그 확인
pm2 restart warehouse-pos   # 재시작
pm2 stop warehouse-pos      # 중지
pm2 delete warehouse-pos    # 등록 해제
```

---

## 문제 해결

### MariaDB 연결 실패
- `DB_PASSWORD` 가 올바른지 확인
- MariaDB 서비스 실행 여부 확인: `sc query mariadb`
- 포트 충돌 확인: `netstat -ano | findstr :3306`

### 포트 충돌
- `.env` 의 `PORT` 값을 다른 번호로 변경 (예: `5050`)
- 방화벽 규칙도 같은 포트로 변경

### npm install 실패
- Node.js 버전 확인: `node --version` (v18 이상 필요)
- 관리자 권한 cmd 에서 재실행

### PM2 시작 후 앱이 계속 재시작됨
- `pm2 logs warehouse-pos` 로 에러 확인
- `.env` 경로나 내용이 올바른지 재확인
