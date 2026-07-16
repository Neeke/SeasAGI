> **English** · [日本語](README.ja.md) · [한국어](README.ko.md) · [简体中文](README.zh.md)

# SeasAGI Server Community

[![Build status](https://ci.appveyor.com/api/projects/status/github/SeasX/SeasAGI?svg=true)](https://ci.appveyor.com/project/SeasX/SeasAGI)
[![macOS](https://img.shields.io/badge/platform-macOS-blue)](https://github.com/SeasX/SeasAGI)
[![Linux](https://img.shields.io/badge/platform-Linux-blue)](https://github.com/SeasX/SeasAGI)
[![Windows](https://img.shields.io/badge/platform-Windows-blue)](https://github.com/SeasX/SeasAGI)
[![License](https://img.shields.io/badge/license-AGPL%20v3-green)](LICENSE)

Community edition cloud sub-project, containing the open-source platform control plane and platform relay gateway. Does not include enterprise governance, billing, or admin dashboard.

## Directory Structure

```text
SeasAGI-Server/
├── README.md
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

## Responsibilities

- `platform-api`: Community cloud control plane — basic authentication, channel management, basic Combo CRUD, basic usage statistics, tenant admin APIs
- `relay-gateway`: Community relay data plane — relay, multimodal forwarding, health checks, tracing, O&M interfaces
- `deploy`: Community deployment, installation, systemd, nginx, O&M scripts
- `scripts/build.sh`: Community unified build entry point

## Community Edition Scope

### Included Capabilities

- Basic authentication: Login / Register / Token refresh
- Basic channel management: Platform channel CRUD
- Basic Combo: User-level Combo CRUD + official template pull
- Basic usage: User usage, grouped by model/channel, timeline, error distribution, recent errors
- Basic tenant management: Members, invite links, custom channel sync, policies, templates, configuration snapshots
- Basic Admin API: User / Plan / Channel / Combo / Relay Gateway basic management
- Relay basic forwarding: Request passthrough, health checks, rate limiting, tracing

### Excluded Capabilities

The following features have been moved to the enterprise project `SeasAGI-Server-Enterprise/`:

- Stripe billing & Checkout Session
- Plan-driven commercial feature gating
- Multi-tenant billing / orders / payments / invoices
- Combo governance (visibility policies, deployment approval)
- Combo metric observability & Provider health indicators
- Enterprise BYOK dual-layer fallback strategy
- Enterprise SSO / SCIM / compliance / audit enhancements / SLA / License
- Admin dashboard frontend `src-admin`

## Common Commands

```bash
# Build community cloud project
bash SeasAGI-Server/scripts/build.sh

# Install to Linux server
sudo bash SeasAGI-Server/deploy/install.sh
```

## Build Artifacts

- `SeasAGI-Server/build/platform-api`
- `SeasAGI-Server/build/relay-gateway`

## Configuration

All configuration is loaded via environment variables. Refer to `deploy/.env.example` to create a `.env` file and export it:

```bash
export $(grep -v '^#' deploy/.env.example | xargs)
```

### Core Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `API_PORT` | Platform API listen port | `9318` |
| `RELAY_PORT` | Relay gateway port | `8318` |
| `DB_PATH` | SQLite database path | `~/.seasagi/platform-api.db` |
| `JWT_SECRET` | JWT signing secret (required in production) | — |
| `JWT_REFRESH_SECRET` | JWT refresh token secret (required in production) | — |
| `ADMIN_SECRET` | Admin login secret | — |
| `CORS_ALLOW_ORIGIN` | CORS allowed origin | — |
| `SEASAGI_DATA_KEY` | Sensitive data encryption key | — |

## License

The community edition is licensed under `AGPL 3.0`. For full enterprise features, see `SeasAGI-Server-Enterprise/`.
