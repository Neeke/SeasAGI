> [English](README.md) · [日本語](README.ja.md) · **한국어** · [简体中文](README.zh.md)

# SeasAGI Server Community

커뮤니티 에디션 클라우드 하위 프로젝트입니다. 오픈소스 플랫폼 컨트롤 플레인과 플랫폼 릴레이 게이트웨이를 포함합니다. 엔터프라이즈 거버넌스, 결제 및 관리자 대시보드는 포함되지 않습니다.

## 디렉토리 구조

```text
SeasAGI-Server/
├── README.md
├── README.ja.md
├── README.ko.md
├── scripts/
│   └── build.sh
├── deploy/
│   ├── build.sh
│   ├── install.sh
│   ├── nginx.conf
│   └── systemd/
├── platform-api/
└── relay-gateway/
```

## 역할

- `platform-api`: 커뮤니티 클라우드 컨트롤 플레인 — 기본 인증, 채널 관리, 기본 Combo CRUD, 기본 사용량 통계, 테넌트 관리 API
- `relay-gateway`: 커뮤니티 릴레이 데이터 플레인 — 릴레이, 멀티모달 전달, 헬스 체크, 트레이스, 운영 인터페이스
- `deploy`: 커뮤니티 배포, 설치, systemd, nginx, 운영 스크립트
- `scripts/build.sh`: 커뮤니티 통합 빌드 진입점

## 커뮤니티 에디션 범위

### 포함 기능

- 기본 인증: 로그인 / 회원가입 / 토큰 갱신
- 기본 채널 관리: 플랫폼 채널 CRUD
- 기본 Combo: 사용자 레벨 Combo CRUD + 공식 템플릿 가져오기
- 기본 사용량: 사용자 사용량, 모델/채널별 그룹화, 타임라인, 오류 분포, 최근 오류
- 기본 테넌트 관리: 멤버, 초대 링크, 사용자 정의 채널 동기화, 정책, 템플릿, 설정 스냅샷
- 기본 Admin API: 사용자 / 플랜 / 채널 / Combo / Relay Gateway 기본 관리
- 릴레이 기본 전달: 요청 투과 전달, 헬스 체크, 속도 제한, 트레이스

### 제외 기능

다음 기능은 엔터프라이즈 프로젝트 `SeasAGI-Server-Enterprise/`로 이전되었습니다:

- Stripe 결제 및 Checkout Session
- 플랜 기반 상업 기능 게이팅
- 멀티 테넌트 청구 / 주문 / 결제 / 인보이스
- Combo 거버넌스 (가시성 정책, 배포 승인)
- Combo 메트릭 관측 및 Provider 상태 지표
- 엔터프라이즈 BYOK 이중 계층 폴백 전략
- 엔터프라이즈 SSO / SCIM / 규정 준수 / 감사 강화 / SLA / 라이선스
- 관리자 대시보드 프론트엔드 `src-admin`

## 자주 사용하는 명령어

```bash
# 커뮤니티 클라우드 프로젝트 빌드
bash SeasAGI-Server/scripts/build.sh

# Linux 서버에 설치
sudo bash SeasAGI-Server/deploy/install.sh
```

## 빌드 산출물

- `SeasAGI-Server/build/platform-api`
- `SeasAGI-Server/build/relay-gateway`

## 설정

모든 설정은 환경 변수를 통해 로드됩니다. `deploy/.env.example`을 참고하여 `.env` 파일을 생성하고 내보내십시오:

```bash
export $(grep -v '^#' deploy/.env.example | xargs)
```

### 핵심 설정

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `API_PORT` | 플랫폼 API 수신 포트 | `9318` |
| `RELAY_PORT` | 릴레이 게이트웨이 포트 | `8318` |
| `DB_PATH` | SQLite 데이터베이스 경로 | `~/.seasagi/platform-api.db` |
| `JWT_SECRET` | JWT 서명 시크릿 (프로덕션 환경 필수) | — |
| `JWT_REFRESH_SECRET` | JWT 리프레시 토큰 시크릿 (프로덕션 환경 필수) | — |
| `ADMIN_SECRET` | 관리자 로그인 시크릿 | — |
| `CORS_ALLOW_ORIGIN` | CORS 허용 오리진 | — |
| `SEASAGI_DATA_KEY` | 민감 데이터 암호화 키 | — |

## 라이선스

커뮤니티 에디션은 `AGPL 3.0`으로 라이선스됩니다. 전체 엔터프라이즈 기능은 `SeasAGI-Server-Enterprise/`를 참조하십시오.
