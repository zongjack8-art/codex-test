# CampusMarket PostgreSQL 兼容性探针

独立事件函数 `rehub_pg_compat` 用于验证可信微信上下文和 `app.rdb()`。它通过 `SECURITY INVOKER` RPC 读取常量 `1`，可选读取一个经批准的存储对象，只返回固定诊断状态。源码使用 SDK `parseContext` 从本次平台调用上下文读取身份。小程序事件参数和进程中上一次调用的微信身份均不参与鉴权。

第四阶段只读检查在 `additional-orangutan-d3abd2399c3` 看到探针云函数和 `public.rehub_pg_compat_check()` 已存在。云函数元数据为 Event、Nodejs20.19、`index.main`，RPC 为调用者权限且数据库函数体引用调用角色。此结果未验证真机调用，也不代表云端已有本目录最新源码。独立配置 `cloudbaserc.json` 仍记录旧 AppID 的探针设置，后续测试新 AppID 前应先核对关联和部署配置。

```powershell
npm --prefix scripts/pg-compat ci --ignore-scripts --no-audit --no-fund
npm --prefix scripts/pg-compat test
```

`probe.sql` 用于探针缺失且获准新建的环境。它还在函数体检查 `service_role`，因此网关是否检查 `GRANT EXECUTE` 不影响授权边界。目标环境已有同名对象时直接停止并检查来源。第四阶段联调顺序、配置和失败处理见[部署准备报告](../../docs/PG-DEPLOYMENT-READINESS.md)。

[SDK RPC](https://docs.cloudbase.net/api-reference/webv3/postgresql/rpc) · [RPC 权限模型](https://docs.cloudbase.net/database/postgresql/rpc) · [实例复用](https://docs.cloudbase.net/cloud-function/instance)
