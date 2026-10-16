# kskbl 两人分工 — Drone Fleet Weibull 工具

**分支：** 只在 `kskbl` 上开发，推送到 `origin/kskbl`。  
**仓库：** https://github.com/yj657/sixsigmahackathon  
**截止（校内）：** 提交 Sat Oct 17, **1 PM ET**；showcase 2–3 PM。  
**更新：** 2026-10-16 19:26 ET  
**Live API：** https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe  
**Docs：** https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe/docs  
**访问：** 已验证无 key 匿名访问 API：`/docs` HTTP 200，线上 `POST /analyze` 数字与本地一致。  
**验收：** 本地 4 条 curl OK；无 key 线上 POST → ĉ≈205.67；`pytest` 17 passed；jiangyijia 新 clone 按根 README 走查通过（H-07）。

| 角色 | 姓名 | 主责 |
|---|---|---|
| **A · 数据 / 演示 / 文档** | jiangyijia | 数据故事、手算核对、demo、README、Devpost |
| **B · 后端 / 统计代码 / 部署** | Percy | `qc.py`、pytest、FastAPI、Posit Connect |

两人共用：每个数字都能口头解释；合并前对方看一眼 diff；统计错了先改 SPEC/测试再改 UI。

---

## 进度看板（CONTRACT）

| ID | 任务 | 状态 | 负责人 |
|---|---|---|---|
| H-01 | SPEC | **done** | 全组 |
| H-02 | `data/` + codebook | **done** | A（已入库） |
| H-03 | `app/qc.py` + pytest | **done** | B · Percy（`3fb5451`） |
| H-04 | FastAPI 接 `qc.py` | **done** | B · Percy（`bca5df7`） |
| H-05 | demo 走查每个 CSV | **in_progress**（等 Percy 独立走查 `demo/README.md` §5 线上命令） | A · jiangyijia |
| H-06 | Posit Connect 部署 | **done** | B · Percy |
| H-07 | README | **done** | A + Percy（新 clone 走查：pytest 17、API、React 4 场景均通过） |
| H-08 | 公开 repo + Devpost | **todo ← 下一步** | 全组 |
| UI | React `app/frontend/` | **done + Connect** | B · Percy — https://connect.systems-apps.com/content/a7bfcdd7-6564-45cb-b74e-09128cde8a93 |

---

## 接口约定（两人对接的“合同”）

CSV 列（不要改名）：

```text
drone_id, time_hours, failed   # failed: 1=失效, 0=仍在飞(右删失)
```

后端核心函数（已在 `app/qc.py`）：

```text
fit_weibull_scale(times, failed, m=2) -> c_hat
weibull_mttf / weibull_reliability / weibull_hazard / b10_life
maintenance_call(c, plan_hours=100) -> "maintain now" | "ok to fly"
analyze_fleet(times, failed, plan_hours=100) -> 全部字段 dict
```

**HTTP（本地 `cd app && ./testme.sh` → http://127.0.0.1:8000）：**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/docs` | 交互文档（评委可点） |
| POST | `/analyze` | JSON：`times`, `failed`, 可选 `plan_hours` |
| GET | `/analyze/file?name=wearout_baseline.csv` | 读仓库 `data/`（**仅本地**；Connect 包无 `data/`，线上用 POST） |

**Known-answer（必须一致）：**

| 检查 | 输入 | 期望（约） |
|---|---|---|
| A | m=2, c=200 | MTTF≈177.245；R(100)≈0.778801；z(100)=0.005 |
| B | `wearout_baseline.csv` | ĉ≈205.670；MTTF≈182.270；R(100)≈0.789 |
| 退化 | `edge_all_censored.csv` | 明确报错（r=0），禁止 inf |

决策：`maintain now` 若 B10 ≤ plan_hours **或** R(plan_hours) < 0.90。  
实测（H-04）：baseline → `c_hat≈205.670`，`call: "maintain now"`。

---

## 角色 A — jiangyijia（数据 / 演示 / 文档）

**Owns：** `data/`（维护）、`demo/`、根 `README.md` 文案、Devpost。  
**现在立刻做：** **H-05** — 写 `demo/README.md`。

| 任务 | CONTRACT | 完成标准 |
|---|---|---|
| ~~三份 CSV + codebook~~ | H-02 done | 已有 |
| 手算能讲出 known A/B | — | showcase 能口述 |
| 每个 CSV：命令/URL、数字、“怎么读”一行 | **H-05** | 组员按文档复现同一数字 |
| 2 分钟口述 demo | H-05 | 技师 → 调 API → maintain/ok |
| 根 README + live URL | H-07 | 新 clone 能跑 |
| Devpost 提交 | H-08 | repo + demo 链接 |

**demo 可写的本地命令示例：**

```bash
cd app && ./testme.sh
curl "http://127.0.0.1:8000/analyze/file?name=wearout_baseline.csv"
curl "http://127.0.0.1:8000/analyze/file?name=early_wearout.csv"
curl "http://127.0.0.1:8000/analyze/file?name=edge_all_censored.csv"
```

线上部署后，把 URL 换成 Connect 地址，改用 `POST /analyze` + JSON body（与 CSV 同行数字）。

**A 不要做：** 在前端重写 Weibull；改 CSV 列名；把 API key 写进文件。

---

## 角色 B — Percy（后端 / 统计 / 部署）

**Owns：** `app/qc.py`、`tests/`、`app/app.py`、`.github/workflows/`、`app/manifest.json`。  
**现在立刻做：** **H-06** — 密钥 + push / 本机 `deployme`，拿到公网 URL。

| 任务 | CONTRACT | 状态 |
|---|---|---|
| Weibull + pytest | H-03 | **done** |
| FastAPI `/analyze` | H-04 | **done** |
| Actions workflow + `manifest.json` + `.python-version` | H-06 | **骨架已好**（未 check-in / 未 LIVE） |
| 加 GitHub secrets → push `kskbl` → Actions 绿 | H-06 | **待你** |
| 或本机 `app/.env` + `./deployme.sh` | H-06 | 更快拿第一个 URL |
| （可选）React → `app/frontend/` | 余力 | 统计稳后再做 |

**H-06 待办（密钥勿进聊天/git）：**

1. GitHub → Settings → Secrets → `CONNECT_SERVER`、`CONNECT_API_KEY`  
2. Commit 部署文件并 `git push origin kskbl`（或 Actions → Run workflow）  
3. 公网 `/docs` 返回 200；`POST /analyze` 得到 ĉ≈205.670  
4. 把 live URL 写给 A（进 demo/README + 根 README）

**B 不要做：** 密钥进仓库；未部署完就大改 UI；自由估计 m（固定 m=2）。

---

## 时间线（当前 → 截止）

```text
[已完成] H-01 SPEC · H-02 data · H-03 qc.py · H-04 FastAPI

现在并行
  A → H-05 demo/README（用本地 curl 数字当标准答案）
  B → H-06 部署（secrets + push / deployme）→ 把 URL 发给 A

然后
  A → H-07 README（填入 live URL）
  全组 → H-08 Devpost（1 PM ET 前）

可选：React 前端（H-06 绿了再做）
```

I-MR：**默认不做**（仅 H-06 稳且有余力再议）。

---

## 协作规则

1. **一人一任务 in_progress**；改 `CONTRACT.yaml` 写自己的名字。  
2. **文件墙：** A 不改 `app/qc.py` / `tests/`；B 不改 `data/*.csv`（除非一起改 SPEC）。  
3. **分支：** `kskbl`；小步 commit → push；另一人先 `git pull`。  
4. **数字：** 以 `SPEC.md` §4 为准。  
5. **Agent：** 一次只 build 一个 H-0x。

---

## 互检清单

- [x] `pytest tests` 通过（H-03）  
- [x] 本地 curl baseline → ĉ≈205.670（H-04）  
- [x] `early_wearout` → maintain now；`edge_all_censored` → 清晰错误（写进 demo）  
- [x] Posit Connect 部署；带 key 线上 POST → ĉ≈205.670  
- [x] Connect **Access → Anyone**（API 已无 key 验证）  
- [x] `demo/README.md` + 根 README 写上 live URL（H-05 / H-07）  
- [x] Devpost 已交；密钥不在 git 里（H-08）  

---

## 一句话分工

- **A · jiangyijia：** 故事、数据、演示、文档。  
- **B · Percy：** 公式、API、上线。  
- **一起：** 任何一个打印出来的数，两人都要能讲清楚。
