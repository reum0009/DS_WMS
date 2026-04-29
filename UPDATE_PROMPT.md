# Warehouse POS 업데이트 방식 (Claude 전달용)

아래 내용을 그대로 클로드에 전달해 분석/개선안을 요청하면 된다.

```text
다음은 우리 프로젝트의 “업데이트(패치) 방식”이다. 코드 흐름을 기준으로 이해하고, 리스크와 개선안을 제안해줘.

[개요]
- 대상: Windows 서버 운영 환경
- 업데이트 산출물: release-v{version}.zip
- 핵심 구성:
  - build-update.bat (배포용 업데이트 ZIP 생성)
  - installer/build-package.js (manifest + 파일해시 포함 app.zip 생성)
  - backend/routes/update.js (업로드/적용/롤백/API)
  - deploy-targets.js (업데이트 대상 경로 정의)
  - updates/, updates/backups/, releases/ (파일 저장 경로)

[업데이트 패키지 생성 방식]
1) build-update.bat 실행
2) 버전 입력 (예: 1.0.1)
3) 필요 시 frontend 빌드 (옵션)
4) installer/build-package.js 실행
   - version.json 갱신
   - backend + frontend/build 파일 수집
   - sha256 해시 맵 생성
   - manifest.json + files/* 구조로 installer/app.zip 생성
5) app.zip을 release-v{version}.zip 이름으로
   - releases/
   - updates/
   두 경로에 복사

[서버 업데이트 API 방식]
- 엔드포인트 베이스: /api/update
- 주요 API:
  - GET /check: 현재 버전 확인(공개)
  - GET /history: 업데이트 이력 조회(admin)
  - GET /log: update.log 조회(admin)
  - GET /packages: updates 폴더 zip 목록(admin)
  - POST /upload: zip 업로드(admin)
  - POST /apply: zip 적용(admin)
  - POST /rollback/:id: 백업 zip으로 롤백(admin)
  - GET /github/check, POST /github/download: GitHub 릴리즈 연동(admin)
  - POST /create-package: 서버에서 패키지 직접 생성(admin)

[적용(POST /apply) 실제 동작]
1) UpdateHistory에 in_progress 기록
2) 현재 실행 파일을 backup-v{version}-{timestamp}.zip으로 백업
   - deploy-targets.js 기준으로 backend, frontend/build, version.json 포함
3) 업데이트 zip 내부 manifest.json 기준으로 변경 파일만 교체
   - 파일 경로: files/{relativePath}
   - 해시 동일하면 스킵
4) backend/package.json 변경 시 npm install --omit=dev 실행
5) UpdateHistory success/failed 기록
6) restart_backend.bat(.sh) 호출 후 프로세스 재시작

[롤백(POST /rollback/:id) 동작]
1) 해당 이력의 backup zip 확인
2) 백업 zip 전체를 ROOT에 복원
3) 롤백 이력 기록 + 대상 이력 상태 rolled_back 처리
4) 서버 재시작

[업데이트 대상 경로 규칙]
- deploy-targets.js:
  - backend/* (단, node_modules/.env/uploads/.env.example 제외)
  - frontend/build/*

[운영 상 특징]
- 업데이트는 “변경 파일만 교체” 방식
- 롤백은 “백업 zip 전체 복원” 방식
- update.log에 작업 로그 축적
- update_history 테이블로 이력 추적

요청사항:
1) 현재 업데이트 방식의 장단점 분석
2) 운영 리스크(무중단성, 데이터 정합성, 실패 복구, 보안) 식별
3) 블루그린/원클릭 롤백/서명검증/무결성검사 관점 개선안 제안
4) 즉시 적용 가능한 우선순위 TOP 10 제시
```

