# `revenue_breakdown` 层级蓝图 — 13 家公司采集照录手册

> 用户拍板（2026-07-13）：所有公司标配 `revenue_breakdown`（层级化产品/收入类型拆解）。
> Google（Alphabet）已入库为标杆形状：10-K Note 2 disaggregation 表原样，Services 挂 4 个 children，
> Cloud / Other Bets / Hedging 带符号单列，`complete=true` 顶层对账=营收。
> 本文给其余 13 家的**照录蓝图**（不含精确数字，数字由采集环节按 filing 原文录）。
>
> **不变量红线（采集时死守，蓝图已按此设计）：**
> 1. 按 filing 原始表逐行录，**不合并、不改名**（中英对照可加）。
> 2. `complete=true` 时：顶层合计**精确**=该期 `revenue`；带 `children` 的节点子项合计**精确**=父节点（validate 两级硬闸）。
> 3. 对冲损益 / 抵消 / 调节项按官方表**带符号单列**（可为负）。
> 4. `revenue_breakdown` 与 `segments[]` **严格分开**——产品收入 ≠ 分部利润口径，不重复计数。
> 5. **无该披露的公司/期，如实省略整键**——绝不为凑标配造重复或估算数据。
> 6. 拿不到精确美元、只有百分比的表，`data_status` 只能标 `derived`（%×营收），且要在 source label 注明口径；
>    **不得冒充 `official`**。

---

## 0. 13 家汇总表（价值评级 × 采集难度 × 建议批次）

| # | 公司 | 最细拆解在哪 | complete 可达 | 与 segments 关系 | 采集通道 | 难度 | 分析价值 | 建议批次 |
|---|------|-------------|--------------|-----------------|---------|------|---------|---------|
| 1 | **Microsoft** | 10-K Note「Revenue — 按重要产品与服务」 | ✅ 精确 | **两张表**（分部=3 platform；产品=~10 行）产品价值远高 | SEC 10-K（Dayu） | 低 | **高** | **批次 1** |
| 2 | **Amazon** | 10-K「Disaggregation of Revenue / 净销售额构成」 | ✅ 精确 | **两张表**（分部=NA/Intl/AWS；产品=7 行）广告/3P 独立可见 | SEC 10-K（Dayu） | 低 | **高** | **批次 1** |
| 3 | **Micron** | 10-K「Revenue by technology / product」DRAM·NAND | ✅ 精确 | **两张表**（分部=4 BU；产品=DRAM/NAND 技术口径）互补 | SEC 10-K（Dayu） | 低 | **高** | **批次 1** |
| 4 | **Oracle** | 10-K 收入确认 Note + MD&A（Cloud services vs License support 拆分） | ✅ 精确（顶层4行）/ 云内拆分需 MD&A | **半重叠**：损益表 4 行=segments；增量=云拆 SaaS/OCI | SEC 10-K（Dayu） | 低-中 | **高** | **批次 1** |
| 5 | **NVIDIA** | 10-K 分部 Note（市场平台）+ MD&A（Data Center→Compute/Networking） | ✅ 平台层精确；DC 子拆在 MD&A 文字 | **大部分重叠**：市场平台=segments；唯一增量=DC 拆 Compute/Networking | SEC 10-K（Dayu） | 中 | 中 | **批次 2** |
| 6 | **TSMC** | 季度 Management Report（6-K）：by technology(node) / by platform | ⚠ 仅百分比、node 为「晶圆收入」口径，**难精确对账** | **两张表**：platform=segments；node 是正交新维度 | SEC 6-K（Dayu，但为%）/ 年报 20-F | 中 | 中-高（node 迁移） | **批次 2** |
| 7 | **ASML** | 20-F：Net system sales vs Net service & field option；系统内 EUV/DUV | ✅ 系统 vs 服务可精确；Logic/Memory 为另一维 | **半重叠**：product-family≈segments；增量=系统/服务、Logic/Memory | SEC 20-F（Dayu） | 中 | 中 | **批次 2** |
| 8 | **Samsung** | 사업보고서（DART，韩文）「매출 실적」按产品：DS→Memory/System LSI/Foundry 等 | ⚠ 需内部抵消行才能对账（division 口径） | **两张表**：分部=DX/DS/SDC/Harman；产品拆 Memory/Foundry 价值高 | 非 SEC（DART PDF，韩/英） | 高 | **高** | **批次 3** |
| 9 | **SK hynix** | 사업보고서（DART，韩文）「품목별 매출」DRAM/NAND/기타 | ✅ 韩元金额可对账（若披露金额而非仅%） | **两张表**：分部=单一 Memory；产品 DRAM/NAND 增量 | 非 SEC（DART PDF，韩/英） | 高 | 中-高（HBM 不单列） | **批次 3** |
| 10 | **Tencent** | 业绩公告 / 年报（HKEX，IFRS）：VAS→游戏(内/外)/社交网络 + 广告 + 金融科技 | ✅ 人民币金额精确 | **同源细化**：分部=4 大类=segments；VAS 内拆是增量 | 非 SEC（HKEX PDF，中/英） | 中 | 中-高 | **批次 3** |
| 11 | **Arm** | 20-F 收入 Note：License and other / Royalty（再拆 external/related party） | ✅ 精确 | **基本重复 segments**（就是同一张 2 行表） | SEC 20-F（Dayu） | 低 | **低** | **省略/同源** |
| 12 | **Broadcom** | 10-K 收入 disaggregation：仅按 2 分部 + 地理 | ✅ 精确但=segments | **完全重复 segments**，无产品级增量 | SEC 10-K（Dayu） | 低 | **低** | **省略** |
| 13 | **SoftBank** | 有価証券報告書（EDINET）/ IFRS 年报：IFRS15 收入拆分 | ⚠ 收入≈电信+Arm，**投资收益不在收入线** | 收入拆解**无法反映 NAV 驱动的真实 thesis** | 非 SEC（EDINET PDF，日/英） | 高 | **低** | **省略** |

**图例**：难度=Dayu/SEC 可达为「低」，需 PDF/非英为「高」；价值=对「判断业务板块」的增量。

---

## 1. Microsoft 微软 — 价值高 · 批次 1

- **披露位置**：Form 10-K，Note「Segment Information and Geographic Data」内的
  **"Our revenue by significant product and service offerings"** 表（FY2025 10-K，`msft-20250630.htm`）。
  季报 10-Q 同表按季给出。注意 FY2025（2024-08 生效）分部重组过，但**产品/服务收入表口径延续**。
- **建议层级树**（照 10-K 行名，均为顶层平铺，无 parent/child）：
  - Server products and cloud services 服务器产品与云服务
  - Office products and cloud services Office 产品与云服务
  - Windows 视窗
  - Gaming 游戏
  - LinkedIn 领英
  - Search and news advertising 搜索与新闻广告
  - Enterprise and partner services 企业与合作伙伴服务
  - Dynamics
  - Devices 设备
  - Other 其他
  > 以 filing 当期实际行名为准（微软历年偶有增减行，如早年「Enterprise Services」→「Enterprise and partner services」）。
- **complete 判定**：✅ 该表**精确加总=总营收**，无调节项。`complete=true`。
- **与 segments 关系**：**两张不同的表**。segments[]=3 个报告分部（Productivity & Business Processes / Intelligent Cloud / More Personal Computing）带分部利润；
  产品表是**跨分部的产品口径**，二者 grain 不同。产品表价值远高——能看到 Azure 所在的「Server products & cloud services」、
  游戏、搜索广告等**具体产品线**，而分部只给三个大桶。**必录，不重复。**
- **通道/难度**：SEC 10-K，Dayu 可达；年度+季度均可得。**低难度。**
- **分析价值**：**高**。这是判断微软 AI/云 vs PC 业务结构的核心口径。

## 2. Amazon 亚马逊 — 价值高 · 批次 1

- **披露位置**：Form 10-K，"Note — Segment Information" 前的 **"Disaggregation of Revenue"**（净销售额构成）表
  （FY2025 10-K，`amzn-20251231.htm`）。10-Q 同表按季给出。
- **建议层级树**（顶层平铺，照 10-K 行名）：
  - Online stores 线上商店
  - Physical stores 实体商店
  - Third-party seller services 第三方卖家服务
  - Advertising services 广告服务
  - Subscription services 订阅服务
  - AWS 亚马逊云
  - Other 其他
- **complete 判定**：✅ 七行**精确加总=净销售额**，无调节项。`complete=true`。
- **与 segments 关系**：**两张不同的表**。segments[]=地理/AWS 三分部（North America / International / AWS）带分部利润；
  产品表是**收入类型口径**。产品表价值高——**广告服务、第三方卖家服务被单独拆出**（分部里被埋在 NA/Intl 内），
  是判断亚马逊高利润业务（广告）成长的关键。**必录，不重复。**
- **通道/难度**：SEC 10-K，Dayu 可达；年度+季度均可得。**低难度。**
- **分析价值**：**高**。广告是亚马逊 alpha 所在，产品表是唯一能看到它的口径。

## 3. Micron 美光 — 价值高 · 批次 1

- **披露位置**：Form 10-K，MD&A / 收入 Note 的 **"revenue by technology / product"**（DRAM、NAND、Other/NOR），
  同时给美元金额与占比（FY2025 10-K，`mu-20250828.htm`）。10-Q 同口径按季给。
- **建议层级树**（顶层平铺，照 filing 行名）：
  - DRAM products DRAM 产品
  - NAND products NAND 产品
  - Other（含 NOR 等，若当期披露）其他
- **complete 判定**：✅ 技术口径**加总=总营收**（DRAM+NAND+Other=100%），可精确对账。`complete=true`。
  > 注意：**HBM 不在此表单列**（美光只在电话会给 HBM 指引，非 filing），故不录 HBM——诚实留空由采集端遵守。
- **与 segments 关系**：**两张互补的表**。segments[]=4 个业务单元（CMBU/CDBU/MCBU/AEBU/Other，按**终端市场**）带分部利润；
  产品表是**按技术（DRAM/NAND）**的正交维度。对存储分析师二者都要：BU 看下游需求结构，技术口径看 DRAM/NAND 周期。**必录，不重复。**
- **通道/难度**：SEC 10-K，Dayu 可达；年度+季度均可得。**低难度。**
- **分析价值**：**高**。DRAM/NAND 是存储周期的第一性拆分。

## 4. Oracle 甲骨文 — 价值高 · 批次 1

- **披露位置**：Form 10-K 收入确认 Note + MD&A（FY2025 10-K，`orcl-20250531.htm`，财年 5/31 结束）。
  损益表 4 行收入；MD&A 进一步把「Cloud services and license support」拆为 **Cloud services（SaaS+OCI）** vs **License support**，
  云内再分 **Cloud Application (SaaS)** 与 **Cloud Infrastructure (OCI/IaaS)**。
- **建议层级树**（顶层=损益表 4 行，第 1 行挂 children）：
  - **Cloud services and license support 云服务及授权支持**（parent）
    - Cloud services 云服务（若 MD&A 给金额）
      - *（可选二级）* Cloud Application (SaaS) / Cloud Infrastructure (OCI)
    - License support 授权支持
  - Cloud license and on-premise license 云授权及本地授权
  - Hardware 硬件
  - Services 服务
- **complete 判定**：✅ **顶层 4 行精确=总营收**，`complete=true`。
  ⚠ children（云内拆分）来自 MD&A，若某期金额不齐则**该 parent 不挂 children**（宁缺——带 children 就必须子项精确=父，validate 硬闸）。
- **与 segments 关系**：**半重叠**。损益表 4 行 ≈ 现 segments[]（Oracle 报 Cloud & license / Hardware / Services 三个经营分部）。
  **增量在云内拆分（OCI 单列）**——这是 Oracle AI 算力 thesis 的核心。若只录 4 行则与 segments 重复、价值有限；
  **价值全在 OCI/SaaS 子拆**。建议录带 children 的树；若拿不到子拆金额，可考虑省略（避免与 segments 纯重复）。
- **通道/难度**：SEC 10-K，Dayu 可达。顶层年度+季度可得；OCI 精确金额季度口径偶需从 MD&A 文字提取，**低-中难度。**
- **分析价值**：**高**（前提是拆出 OCI）。

## 5. NVIDIA 英伟达 — 价值中 · 批次 2

- **披露位置**：Form 10-K 分部 Note——2 个报告分部（Compute & Networking / Graphics）带利润；
  以及 **"Revenue by specialized market"**（Data Center / Gaming / Professional Visualization / Automotive / OEM & Other）。
  MD&A 内把 **Data Center 拆为 Compute 与 Networking** 两块（文字/表）。
- **建议层级树**（若录，市场平台顶层，Data Center 挂 children）：
  - **Data Center 数据中心**（parent）
    - Compute 计算（GPU）
    - Networking 网络（NVLink/InfiniBand/Ethernet）
  - Gaming 游戏
  - Professional Visualization 专业可视化
  - Automotive 汽车
  - OEM & Other OEM 及其他
- **complete 判定**：✅ 市场平台层加总=总营收；Data Center 的 Compute+Networking=Data Center（若 MD&A 给全金额）。
  ⚠ Compute/Networking 拆分在 MD&A，季度口径偶不齐——不齐则 Data Center **不挂 children**。
- **与 segments 关系**：**大部分重复**。现 segments[]=市场平台表（Data Center/Gaming/…）。
  **唯一增量 = Data Center → Compute/Networking 子拆**（判断 InfiniBand/Ethernet 网络附加值）。
  若不录该子拆，则 revenue_breakdown 与 segments 纯重复——**建议只在能挂 Compute/Networking children 时才录**，否则省略。
- **通道/难度**：SEC 10-K，Dayu 可达。**中难度**（子拆需 MD&A 提取）。
- **分析价值**：**中**。增量集中在网络 vs 计算的拆分。

## 6. TSMC 台积电 — 价值中-高 · 批次 2

- **披露位置**：**季度 Management Report（SEC 6-K 附件）** 与年报（20-F / 中文年报）。内含
  **by technology（制程节点：3nm/5nm/7nm/…）** 与 **by platform（HPC/Smartphone/IoT/Automotive/DCE/Others）** 两张构成表。
  ⚠ **均以百分比披露**，且 **node 表是「晶圆收入（wafer revenue）」口径**（不含约 10% 封测/其他），platform 是「净收入」口径。
- **建议层级树**（node 维度，顶层平铺）：
  - 3nm / 5nm / 7nm / 16nm / 28nm / 其他成熟节点（照当期 Management Report 行名与分档）
- **complete 判定**：⚠ **难精确对账**。① 仅百分比 → 金额需 %×营收反推，`data_status` 只能 `derived`；
  ② node 为晶圆收入口径、不等于总营收 → **顶层加不到公司营收**。
  故建议 **`complete=false`**（不触发顶层=营收硬闸），source label 注明「晶圆收入口径百分比，derived」。
  若要 complete，须补一行「Non-wafer / 封测及其他」轧差——但官方不给该行金额，**宁可 `complete=false` 也不造轧差行**。
- **与 segments 关系**：**两张正交表**。现 segments[]=platform（终端市场）带 op_income；node 是**制程迁移维度**（判断 3nm 放量/先进制程占比），
  是 TSMC 定价权与 AI 算力 thesis 的核心。**node 表价值高、必录（作为 revenue_breakdown）；platform 已在 segments，不重复。**
- **通道/难度**：SEC 6-K（Dayu 可达，但内容是 PDF/百分比，提取需人工）。年度+季度均可得。**中难度。**
- **分析价值**：**中-高**（node 迁移）。但受「百分比/晶圆口径」限制，标 `derived`+`complete=false`。

## 7. ASML — 价值中 · 批次 2

- **披露位置**：Form 20-F 年报（SEC 可达）+ ASML 官网年报。收入构成：
  **Net system sales**（系统销售，内部再按 EUV / ArF immersion(DUV) / ArF dry / KrF / I-line 及 **Logic vs Memory** 终端）
  与 **Net service and field option sales**（服务与现场升级，≈ Installed Base Management）。
- **建议层级树**（系统/服务顶层，系统挂产品族 children）：
  - **Net system sales 系统净销售**（parent）
    - EUV 先进光刻系统
    - DUV（ArFi/ArF dry/KrF/i-line，照年报分档）成熟光刻系统
  - Net service and field option sales 服务与现场升级净销售
  > **Logic vs Memory 是另一维度**（同一系统销售的另一种切法），**不能与产品族放同一棵树**——如需 Logic/Memory 另开一节或不录。
- **complete 判定**：✅ **系统 + 服务 = 总营收**，可精确对账；系统内 EUV/DUV children 若年报给全金额则子项=父。`complete=true`。
- **与 segments 关系**：**半重叠**。现 segments[]=EUV/DUV/Metrology&Inspection/Installed Base Management（产品族+服务视角）。
  revenue_breakdown 的「系统 vs 服务」是**更规整的官方两分**，EUV/DUV 与 segments 部分重叠。
  增量有限——若 segments 已覆盖产品族，可考虑**只补「系统 vs 服务」两分或省略**，避免重复。价值中。
- **通道/难度**：SEC 20-F，Dayu 可达；年报为主，季度构成在季度 IR 材料。**中难度。**
- **分析价值**：**中**。真正高价值的是 Logic/Memory 终端拆分，但那是另一维、且需单独处理。

## 8. Samsung 三星电子 — 价值高 · 批次 3

- **披露位置**：**사업보고서（Business Report，DART 提交，韩文；另有英文季度/年度 earnings release）**。
  「매출 실적（销售业绩）」按产品披露：**DS 内 → Memory / System LSI / Foundry**；**DX 内 → MX(手机)/VD(影像)/DA(家电)/Networks**；SDC；Harman。
- **建议层级树**（按事业部挂产品 children，照报告行名）：
  - **DX 部门**（parent）→ MX / Networks / VD / DA
  - **DS 部门**（parent）→ **Memory 存储** / System LSI / **Foundry 代工**
  - SDC 显示面板
  - Harman 车载/音频
  - *（可能需）* 内部抵消 Inter-segment elimination（带负号单列）
- **complete 判定**：⚠ segments 为 **division 口径（含内部交易）**，产品明细同样含内部交易；
  要顶层=合并营收，**需带符号单列内部抵消行**（官方「연결조정/부문간 매출 제거」）。
  若报告给的是**对外部客户的销售额**则可直接加总。**采集时先确认是「总额」还是「对外」口径**，据此决定是否加抵消行与 `complete`。
- **与 segments 关系**：**两张表**。segments[]=DX/DS/SDC/Harman 大部门；
  **产品拆 Memory / Foundry（DS 内）价值极高**——这是判断三星存储 vs 代工景气的唯一口径，分部大桶看不到。**必录。**
- **通道/难度**：**非 SEC**，DART PDF（韩/英），需人工提取、口径核对。**高难度。**
- **分析价值**：**高**（Memory/Foundry 拆分），但难度高，排批次 3。

## 9. SK hynix — 价值中-高 · 批次 3

- **披露位置**：**사업보고서（DART，韩文；另有英文 earnings materials）** 的「품목별 매출（按品目销售）」：
  **DRAM / NAND Flash / 기타(Other)**。
- **建议层级树**（顶层平铺，照报告行名）：
  - DRAM
  - NAND Flash
  - Other 其他
- **complete 判定**：✅ 若报告给**韩元金额**（品목별 매출 통常给金额与占比），三行加总=总营收，可对账，`complete=true`。
  ⚠ 若某期只给占比区间（历史上偶有），则标 `derived` 且 `complete=false`。
  > **HBM 不在此表单列**（只在电话会/IR 提及），不录 HBM——诚实留空。
- **与 segments 关系**：**两张表**。segments[]=单一「Memory」（信息量低）；产品拆 DRAM/NAND 是**唯一的业务结构口径**，增量明显。**必录。**
- **通道/难度**：**非 SEC**，DART PDF（韩/英）。**高难度。**
- **分析价值**：**中-高**（DRAM/NAND 拆分有用；HBM 缺失限制上限）。

## 10. Tencent 腾讯控股 — 价值中-高 · 批次 3

- **披露位置**：**业绩公告 / 年报（HKEX 提交，IFRS，中英对照 PDF）**。收入按四大类，VAS 内再拆：
  **增值服务 VAS →（本土市场游戏 / 国际市场游戏 / 社交网络）**；网络广告（营销服务）；金融科技及企业服务；其他。
- **建议层级树**（VAS 挂 children，照公告行名）：
  - **增值服务 Value-Added Services**（parent）
    - 本土市场游戏 Domestic games
    - 国际市场游戏 International games
    - 社交网络 Social networks
  - 网络广告 / 营销服务 Online advertising / Marketing services
  - 金融科技及企业服务 FinTech and Business Services
  - 其他 Others
- **complete 判定**：✅ **人民币金额精确**，四大类加总=总营收，VAS 三子=VAS。`complete=true`。
- **与 segments 关系**：**同源细化**。现 segments[]=四大类（=IFRS 报告口径，就是这张表的顶层）。
  **增量 = VAS 内拆游戏(内/外)/社交网络**——判断游戏出海与视频号广告结构的关键。
  若不拆 VAS 则与 segments 重复；**价值在 VAS 子拆，建议录带 children 的树。**
- **通道/难度**：**非 SEC**，HKEX PDF（中/英，口径清晰、金额齐全，比韩日报告好取）。年度+季度均可得。**中难度。**
- **分析价值**：**中-高**。

## 11. Arm 安谋 — 价值低 · 建议省略 / 同源

- **披露位置**：Form 20-F 收入 Note（`arm-20xx0331.htm`，财年 3/31 结束）：
  **License and other revenue** / **Royalty revenue**（每类再拆 external customers vs related parties）。
- **建议**：这张表**就是现 segments[]**（License and other / Royalty，已入库）。
  20-F 的唯一细化是 external / related party 拆分——对「判断业务板块」增量极低（关联方主要是合资实体口径问题，非产品线）。
- **complete 判定**：✅ 两行=总营收，若录可 `complete=true`。但**与 segments 纯重复**。
- **结论**：**建议省略 revenue_breakdown**（避免重复数据）；如坚持标配，则明确「与 segments 同源」，
  且仅在需要 external/related-party 拆分时才录为 children。**低价值。** SEC 20-F，Dayu 可达，难度低但无必要。

## 12. Broadcom 博通 — 价值低 · 建议省略

- **披露位置**：Form 10-K 收入 disaggregation Note：仅按**两个分部（Semiconductor solutions / Infrastructure software）** + 地理。
  **无产品级 / AI 收入的 filing 内披露**（AI 收入仅在电话会以 non-GAAP 口径给出，不入财报表）。
- **建议**：分部两行=现 segments[]，revenue_breakdown 无任何产品级增量。
- **complete 判定**：✅ 但=segments，纯重复。
- **结论**：**建议省略**。想要的 AI/网络芯片拆分 filing 不给——**诚实留空，不从电话会搬 non-GAAP 数**。**低价值。**

## 13. SoftBank 软银集团 — 价值低 · 建议省略

- **披露位置**：**有価証券報告書（EDINET，日文）/ IFRS 英文年报**。IFRS 15 收入拆分存在，但 SoftBank 的收入 ≈
  **SoftBank Corp（电信）+ Arm + PayPay 等运营公司**；而其价值核心——**Vision Funds / 控股公司投资的投资损益不在「收入」线**（在损益表投资收益/公允价值变动）。
- **建议**：收入拆解**无法反映 SoftBank 由 NAV / 投资损益驱动的真实 thesis**，且会被电信收入主导而误导。
- **complete 判定**：⚠ 收入可拆，但拆出来对分析师**没有决策价值**；反而其失真口径若混入半导体同业会污染 comps 中位数。
- **结论**：**建议省略 revenue_breakdown**。SoftBank 该看的是 NAV / 分部投资收益（已在 segments），不是产品收入。
  **非 SEC，EDINET PDF（日/英），高难度，低价值——不投入。**

---

## 附：采集批次顺序与理由（给采集/PM）

- **批次 1（高价值 × SEC 易取，先做）**：**Microsoft / Amazon / Micron / Oracle**。
  四家都是 10-K SEC filer（Dayu 可达）、金额精确可对账（`complete=true`）、且产品表与 segments **真正互补**
  （MSFT 产品线、AMZN 广告/3P、MU 的 DRAM/NAND、ORCL 的 OCI）。ROI 最高。
  - Oracle 一个前置判断：**只有能拆出 Cloud services→OCI/SaaS 才值得录**；拿不到子拆就退化成与 segments 重复，可暂缓。
- **批次 2（中价值 × SEC 可达但需人工/有口径 caveat）**：**NVIDIA / TSMC / ASML**。
  - NVDA：**仅在能挂 Data Center→Compute/Networking children 时才录**，否则与 segments 重复、省略。
  - TSMC：录 **node 表**（正交高价值），但只有百分比 + 晶圆口径 → 标 `data_status=derived`、`complete=false`，不造轧差行。
  - ASML：增量有限，优先「系统 vs 服务」两分；Logic/Memory 若要则单独处理。可最后做或降级。
- **批次 3（高/中价值但非 SEC、PDF 难取）**：**Samsung / SK hynix / Tencent**。
  - Tencent 先做（HKEX 中英 PDF、金额齐、VAS 子拆价值高、口径干净）。
  - Samsung / SK hynix 后做（DART 韩文 PDF、需口径核对；Samsung 注意 division 内部抵消行、SK hynix 注意是否只有占比）。

## 明确「无需录 / 低价值」清单

| 公司 | 结论 | 原因 |
|------|------|------|
| **Arm** | **建议省略**（或标同源） | 20-F 收入表就是 segments（License/Royalty），无产品级增量；细化仅 external/related-party，决策价值低 |
| **Broadcom** | **建议省略** | 10-K 仅按 2 分部 + 地理，=segments；AI/产品拆分 filing 不给（只在电话会 non-GAAP）——不搬非财报数 |
| **SoftBank** | **建议省略** | 真实 thesis 由 NAV/投资损益驱动，收入拆解被电信主导、无决策价值，且失真口径会污染半导体 comps |

> 三家共性：**为「标配」造重复或误导数据，违背项目诚信不变量。宁可省略整键，也不为凑齐 13 家而造噪声。**
