# 창고관리시스템 웹버전 POS기

웹 기반 창고 관리 시스템으로, 편의점 POS처럼 직관적인 UI를 제공합니다. 3단계 승인 프로세스(신청 → 승인 → 출고)를 통해 재지급 방지를 구현했습니다.

## 기능

- **3단계 승인 프로세스**: 신청자 → 승인자 → 출고자
- **혼합형 입출고 관리**: 물품/재고, 현금/금액, 문서/서류
- **재지급 방지**: 동일 신청 중복 처리 방지
- **POS 스타일 UI**: 탭 기반 직관적인 인터페이스
- **실시간 통계**: 신청, 승인대기, 완료, 반려 현황
- **종합 레포트**: Excel 다운로드 지원
- **MySQL 또는 MongoDB 지원**: 원하는 데이터베이스 선택 가능

## 🚀 빠른 시작 (3 단계)

### 사전 요구사항
- Node.js (v14+) 설치
- **MySQL** 설치 및 실행 (또는 MongoDB)

### 1️⃣ 데이터베이스 시작
```bash
# MySQL 선택
net start MySQL80

# 또는 MongoDB 선택
net start MongoDB
```

### 2️⃣ 백엔드 실행 (터미널 1)
```bash
cd backend
npm install
npm run dev
```
→ http://localhost:5000

### 3️⃣ 프론트엔드 실행 (터미널 2)
```bash
cd frontend
npm install
npm start
```
→ http://localhost:3000

📖 **[MySQL 설정 가이드](./MYSQL_SETUP.md)** | **[자세한 설치 가이드](./SETUP_GUIDE.md)** | **[5분 빠른 시작](./QUICK_START.md)**

## API 엔드포인트

- 인증: `/api/auth`
- 신청: `/api/requests`
- 승인: `/api/approvals`
- 출고: `/api/releases`
- 레포트: `/api/reports`
- 사용자: `/api/users`

## 기술 스택

- **백엔드**: Node.js, Express, MongoDB, JWT
- **프론트엔드**: React
- **보안**: bcrypt, JWT 인증

## 배포

로컬 환경에서 실행 가능. 프로덕션 배포 시 MongoDB Atlas 등 클라우드 데이터베이스 사용 권장.# Warehouse-pos
