// test-data-module.js — 入口薄壳（保持向后兼容：node/bun、web prebuild、CI 均调本文件）。
// 测试已拆两层，职责分明：
//   test-logic.js    —— 数据无关的纯逻辑回归（合成数据、边界、null 降级）。永不因数据刷新而改。
//   test-snapshot.js —— 真实数据派生值对照 test-snapshot.expected.json 快照对账。
//                       数据变更 = 人工确认 → `node test-snapshot.js --update` → git diff 复核。
// 两者都是 CJS，可各自单独跑（`node test-logic.js` / `node test-snapshot.js`）便于定位。
require("./test-logic.js");    // 逻辑回归（失败即抛，中止）
require("./test-snapshot.js"); // 快照对账（比对模式；传 --update 则重生成快照）
console.log("data-module tests passed（logic + snapshot）");
