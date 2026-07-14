> [English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **简体中文**

# SeasAGI Server Community

社区版云端子项目，包含开源平台控制面与平台中继网关，不包含企业治理、计费和管理后台。

## 目录

```text
SeasAGI-Server/
├── README.md
├── README.ja.md
├── README.ko.md
├── README.zh.md
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

## 职责

- `platform-api`：社区版云端控制面，负责基础认证、通道管理、基础 Combo CRUD、基础用量统计、租户管理员接口
- `relay-gateway`：社区版中继数据面，负责 relay、多模态转发、健康检查、trace、运维接口
- `deploy`：社区版部署、安装、systemd、nginx、运维脚本
- `scripts/build.sh`：社区版统一构建入口

## 社区版范围

### 包含能力

- 基础认证：登录 / 注册 / Token 刷新
- 基础通道管理：平台通道 CRUD
- 基础 Combo：用户级 Combo CRUD + 官方模板拉取
- 基础用量：用户用量、按模型/通道分组、时间线、错误分布、近期错误
- 基础租户管理：成员、邀请链接、自定义通道同步、策略、模板、配置快照
- 基础 Admin API：用户 / 套餐 / 通道 / Combo / Relay Gateway 基础管理
- Relay 基础转发：请求透传、健康检查、限流、trace

### 不包含能力

以下内容已移至企业版项目 `SeasAGI-Server-Enterprise/`：

- Stripe 计费与 Checkout Session
- 套餐驱动的商业功能门控
- 多租户账单 / 订单 / 支付 / 发票
- Combo 治理（可见性策略、部署审批）
- Combo 指标观测与 Provider 健康指标
- 企业 BYOK 双层回退策略
- 企业 SSO / SCIM / 合规 / 审计增强 / SLA / License
- 管理后台前端 `src-admin`

## 常用命令

```bash
# 编译社区版云端项目
bash SeasAGI-Server/scripts/build.sh

# 安装到 Linux 服务器
sudo bash SeasAGI-Server/deploy/install.sh
```

## 构建产物

- `SeasAGI-Server/build/platform-api`
- `SeasAGI-Server/build/relay-gateway`

## 配置说明

所有配置通过环境变量加载，参考 `deploy/.env.example` 创建 `.env` 文件并导出：

```bash
export $(grep -v '^#' deploy/.env.example | xargs)
```

### 核心配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `API_PORT` | 平台 API 监听端口 | `9318` |
| `RELAY_PORT` | 中继网关端口 | `8318` |
| `DB_PATH` | SQLite 数据库路径 | `~/.seasagi/platform-api.db` |
| `JWT_SECRET` | JWT 签名密钥（生产环境必改） | — |
| `JWT_REFRESH_SECRET` | JWT 刷新令牌密钥（生产环境必改） | — |
| `ADMIN_SECRET` | 管理员登录密钥 | — |
| `CORS_ALLOW_ORIGIN` | 跨域允许来源 | — |
| `SEASAGI_DATA_KEY` | 敏感数据加密密钥 | — |

## 许可

社区版使用 `AGPL 3.0`。完整企业功能请见 `SeasAGI-Server-Enterprise/`。
