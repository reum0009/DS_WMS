# 📦 웹 방식 창고 관리 시스템 (WMS)

## 👥 팀원 및 역할
- **팀원 1 (팀장)**: 전체 아키텍처 및 레포지토리 관리
- **팀원 2~6**: 각 기능별 브랜치 담당 (입고, 출고, 재고 조회 등)

## 🌿 브랜치 전략
- `main`: 배포 가능한 상태의 최신 코드만 유지
- `feature/기능이름`: 각 팀원의 작업 공간 (예: `feature/inbound`, `feature/inventory`)

## 🛠️ 협업 프로세스
1. `main` 브랜치에서 최신 코드 가져오기 (`git pull origin main`)
2. 본인 브랜치 생성 및 작업 (`git checkout -b feature/기능명`)
3. 작업 완료 후 Push 및 **Pull Request(PR)** 생성
4. 팀원 1명 이상의 승인 후 `main`에 머지
