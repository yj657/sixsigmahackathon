# kskbl 两人分工 — Drone Fleet Weibull 工具

**分支：** 只在 `kskbl` 上开发，推送到 `origin/kskbl`。  
**仓库：** https://github.com/yj657/sixsigmahackathon  
**已完成：** H-01（SPEC）· H-02（测试数据 + codebook，commit `28fae9f`）  
**截止（校内）：** 提交 Sat Oct 17, **1 PM ET**；showcase 2–3 PM。

把姓名写进括号：

| 角色 | 姓名 | 主责 |
|---|---|---|
| **A · 数据 / 演示 / 文档** | （　　　） | 数据故事、手算核对、demo、README、Devpost |
| **B · 后端 / 统计代码 / 部署** | （　　　） | `qc.py`、pytest、FastAPI、Posit Connect |

两人共用：每个数字都能口头解释；合并前对方看一眼 diff；统计错了先改 SPEC/测试再改 UI。

---

## 接口约定（两人对接的“合同”）

CSV 列（不要改名）：

```text
drone_id, time_hours, failed   # failed: 1=失效, 0=仍在飞(右删失)
```

后端核心函数（B 实现，A 用结果写 demo）：

```text
fit_weibull_scale(times, failed, m=2) -> c_hat
weibull_mttf(c, m=2) -> mttf
weibull_reliability(t, c, m=2) -> R
weibull_hazard(t, c, m=2) -> z
b10_life(c, m=2) -> hours
maintenance_call(c, plan_hours=100, m=2) -> "maintain now" | "ok to fly"
```

**Known-answer（必须一致）：**

| 检查 | 输入 | 期望（约） |
|---|---|---|
| A | m=2, c=200 | MTTF≈177.245；R(100)≈0.778801；z(100)=0.005 |
| B | `wearout_baseline.csv` | ĉ≈205.670；MTTF≈182.270；R(100)≈0.789 |
| 退化 | `edge_all_censored.csv` | 明确报错（r=0），禁止 inf |

决策：`maintain now` 若 B10 ≤ plan_hours **或** R(plan_hours) < 0.90。

---

## 角色 A — 数据 / 演示 / 文档

**Owns（优先）：** `data/`（维护）、`demo/`、`README.md` 里数据与使用说明、Devpost 文案。  
**可协助：** `app/frontend/` 文案与“如何读图”（H-05 后半）。

| 时段（建议） | 任务 | CONTRACT | 完成标准 |
|---|---|---|---|
| 现在 → +1h | 精读 `SPEC.md` §4 与 `data/README.md`；用计算器/纸笔复算 known A/B | — | 能不看稿说出 ĉ、MTTF、R(100) |
| 并行于 H-03 | 核对三份 CSV；若改数据，同步改 codebook 与 SPEC 数字 | H-02 维护 | `ls data/*.csv` 仍为 3 个；列名不变 |
| H-03 绿灯后 | 写 `demo/README.md`：每个 CSV 的命令/URL、打印数字、“怎么读”一行 | H-05 | 组员按文档能复现同一数字 |
| API/前端可用后 | 准备 2 分钟口述 demo（技师 → 上传 → maintain/ok） | H-05 | showcase 可讲完 |
| 部署后 | 根目录 README：给谁用、输入、一键 `testme`、live URL、链到 `demo/` | H-07 | 新 clone 按 README 能跑 |
| 截止前 | Devpost：repo 链接 + 演示；确认无密钥进库 | H-08 | 提交页填齐 |

**A 不要做：** 在 React 里重写 Weibull 公式；另起一套列名。

---

## 角色 B — 后端 / 统计 / 部署

**Owns：** `app/qc.py`、`tests/`、`app/`（FastAPI）、`.github/workflows/`（部署）、`app/manifest.json`。  
**顺序硬约束：** 先 H-03 测试通过 → 再 H-04 API → 再部署；**禁止**先做漂亮 UI。

| 时段（建议） | 任务 | CONTRACT | 完成标准 |
|---|---|---|---|
| 现在 → +2h | 复制 `demos/fastapi/` → `app/`；写 `app/qc.py` + `tests/`（known A/B + r=0） | H-03 | `pytest tests` 全绿；数字对齐 SPEC |
| 紧接着 | 薄路由：读 CSV / JSON → 调 `qc.py` → 返回 JSON（ĉ, MTTF, R, z, B10, call） | H-04 | `app/testme` + curl 对 `wearout_baseline.csv` = pytest 数字 |
| H-04 本地通 | 加 GitHub Actions + Connect secrets；`manifestme`；部署 | H-06 | 公网 URL 登出可开，返回 H-03 数字 |
| 有余力 | 复制 `demos/reactfront/` → `app/frontend/`，只展示 API 结果 | H-04/H-05 | 上传 CSV 或选示例文件即可 |
| 全程 | 不把 API key 写进文件；分支 `kskbl` 上 push | — | `git grep` 无真密钥 |

**B 不要做：** 在未 pytest 通过前改前端样式；自由估计形状 m（v1 固定 m=2）。

---

## 时间线（24h 冲刺 · 两人并行）

```text
现在          H-03 统计函数 + 测试          ← B 主责；A 手算旁听/对答案
   │
   ├─ H-03 PASS 后 ── H-04 FastAPI          ← B
   │                 A 开始写 demo 草稿（用 pytest 输出当“标准答案”）
   │
   ├─ H-04 curl 绿 ── H-06 部署尽早          ← B（别拖到最后）
   │                 H-05 demo 定稿           ← A
   │                 （可选）React 接线       ← B 为主，A 写说明文字
   │
   └─ 最后 2–3h ── H-07 README + H-08 Devpost ← A 主笔，B 补 API/URL
```

I-MR 控制图：**仅当** H-03～H-06 都稳了再商量，默认不做。

---

## 协作规则（避免撞车）

1. **一人一任务 in_progress**：改 `CONTRACT.yaml` 时写上自己的名字。  
2. **文件墙：** A 默认不改 `app/qc.py` / `tests/`；B 默认不改 `data/*.csv`（除非一起改 SPEC）。  
3. **合并节奏：** 小步 commit → `git push origin kskbl`；另一人 `git pull` 再动手。  
4. **数字冲突：** 以 `SPEC.md` §4 手算为准；代码不服 SPEC 就改代码。  
5. **Agent：** 可继续用 Cursor `/superagent`；一次只 build 一个 H-0x。

---

## 今晚互检清单（两人一起勾）

- [ ] `pytest tests` 通过，且能解释 every number  
- [ ] curl / 页面在 `wearout_baseline` 上得到 ĉ≈205.670  
- [ ] `early_wearout` → maintain now；`edge_all_censored` → 清晰错误  
- [ ] Posit Connect 公网 URL 可开  
- [ ] README + demo 文档可独立复现  
- [ ] Devpost 已交；密钥不在 git 里  

---

## 一句话分工

- **A：** 保证“故事、数据、演示、文档”评委听得懂、跟得上。  
- **B：** 保证“公式、API、上线”数字对、服务活。  
- **一起：** 任何一个打印出来的数，两人都要能讲清楚。
