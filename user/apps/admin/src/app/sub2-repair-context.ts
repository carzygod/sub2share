export interface Sub2RepairContext {
  accountId?: string | null;
  sub2AccountName?: string;
  accountStatus?: string;
  credentialsStatus?: string;
  schedulable?: string;
  accountMessage?: string;
  accountUpdatedAt?: string;
  tempUnschedulableReason?: string;
  checkId?: string;
  checkLabel?: string;
  repairAction?: string;
  actionHint?: string;
  resourceId?: string;
  resourceType?: string;
  resourceStatus?: string;
  resourceScope?: string;
  supplierEmail?: string;
  requestId?: string;
  proxyRequestLogId?: string;
  upstreamRequestId?: string;
  proxyRequestPath?: string;
  proxyRequestStatusCode?: string;
  proxyRequestErrorCode?: string;
  model?: string;
  modelsOk?: string;
  responsesOk?: string;
  localProxyOk?: string;
  smokeTestSkippedReason?: string;
  ageMinutes?: string;
  stale?: string;
  staleThresholdMinutes?: string;
  freshMinutesRemaining?: string;
  staleAt?: string;
}

export interface ResourceCreateDefaults {
  supplierEmail?: string;
  resourceType?: string;
  sub2AccountId?: string;
  repairAction?: string;
  checkId?: string;
  resourceScope?: string;
  resourceStatus?: string;
  productId?: string;
  productName?: string;
  priceId?: string;
  sub2AccountName?: string;
  accountStatus?: string;
  credentialsStatus?: string;
  schedulable?: string;
  tempUnschedulableReason?: string;
  accountMessage?: string;
  accountUpdatedAt?: string;
  model?: string;
  responsesOk?: string;
  localProxyOk?: string;
  smokeTestSkippedReason?: string;
  proxyRequestPath?: string;
  proxyRequestStatusCode?: string;
  proxyRequestErrorCode?: string;
  ageMinutes?: string;
  stale?: string;
  staleThresholdMinutes?: string;
  freshMinutesRemaining?: string;
  staleAt?: string;
}

export interface Sub2RepairContextItem {
  label: string;
  value: string;
}

export function sub2RepairContextItems(context: Sub2RepairContext): Sub2RepairContextItem[] {
  const account = context.accountId
    ? `#${context.accountId}${context.sub2AccountName ? ` / ${context.sub2AccountName}` : ""}`
    : context.sub2AccountName;
  const resource = [context.resourceId, context.resourceType, context.resourceStatus, context.resourceScope]
    .filter(Boolean)
    .join(" / ");
  const request = [context.requestId, context.proxyRequestLogId, context.upstreamRequestId]
    .filter(Boolean)
    .join(" / ");
  const smoke = [
    context.model ? `model ${context.model}` : undefined,
    healthFlag("models", context.modelsOk),
    healthFlag("responses", context.responsesOk),
    healthFlag("local", context.localProxyOk)
  ].filter(Boolean).join(" / ");
  const failingRequest = [
    context.proxyRequestPath,
    context.proxyRequestStatusCode ? `HTTP ${context.proxyRequestStatusCode}` : undefined,
    context.proxyRequestErrorCode,
    context.smokeTestSkippedReason ? `skip ${context.smokeTestSkippedReason}` : undefined,
    context.ageMinutes ? `${context.ageMinutes} 分钟前` : undefined,
    context.staleThresholdMinutes ? `阈值 ${context.staleThresholdMinutes} 分钟` : undefined,
    context.freshMinutesRemaining && context.stale !== "true" ? `剩余 ${context.freshMinutesRemaining} 分钟过期` : undefined,
    context.staleAt ? `staleAt ${context.staleAt}` : undefined,
    context.stale === "true" ? "证据已过期" : undefined
  ].filter(Boolean).join(" / ");
  const accountDiagnostics = [
    context.schedulable ? `schedulable ${context.schedulable}` : undefined,
    context.tempUnschedulableReason ? `temp ${context.tempUnschedulableReason}` : undefined,
    context.accountUpdatedAt ? `updated ${context.accountUpdatedAt}` : undefined,
    context.accountMessage ? context.accountMessage.slice(0, 240) : undefined
  ].filter(Boolean).join(" / ");
  return [
    { label: "来源", value: [context.checkLabel, context.checkId].filter(Boolean).join(" / ") },
    { label: "维修动作", value: context.repairAction },
    { label: "维修建议", value: context.actionHint },
    { label: "目标账号", value: account },
    { label: "账号状态", value: [context.accountStatus, context.credentialsStatus].filter(Boolean).join(" / ") },
    { label: "账号诊断", value: accountDiagnostics },
    { label: "资源", value: resource },
    { label: "供给方", value: context.supplierEmail },
    { label: "请求定位", value: request },
    { label: "Smoke", value: smoke },
    { label: "失败请求", value: failingRequest }
  ].filter((item): item is Sub2RepairContextItem => Boolean(item.value));
}

export function sub2RepairContextShouldRunSmokeTest(context: Sub2RepairContext) {
  return context.checkId === "localProxySmoke"
    || context.responsesOk === "false"
    || context.localProxyOk === "false"
    || Boolean(context.proxyRequestPath || context.proxyRequestStatusCode || context.proxyRequestErrorCode);
}

export function sub2RepairContextSmokeModel(context: Sub2RepairContext) {
  return context.model?.trim() || "";
}

export function resourceCreateDefaultsShouldApplyCredential(defaults: ResourceCreateDefaults) {
  return defaults.repairAction === "apply_openai_refresh_token_to_sub2_account" && Boolean(defaults.sub2AccountId?.trim());
}

export function resourceCreateDefaultsShouldRunSmokeTest(defaults: ResourceCreateDefaults) {
  if (!resourceCreateDefaultsShouldApplyCredential(defaults)) return false;
  return defaults.resourceType === "codex"
    || defaults.checkId === "resources"
    || defaults.resourceScope === "production"
    || defaults.responsesOk === "false"
    || defaults.localProxyOk === "false"
    || Boolean(defaults.proxyRequestPath || defaults.proxyRequestStatusCode || defaults.proxyRequestErrorCode);
}

export function resourceCreateDefaultsSmokeModel(defaults: ResourceCreateDefaults) {
  return defaults.model?.trim() || "";
}

export function resourceCreateDefaultsProductText(defaults: ResourceCreateDefaults) {
  return [
    defaults.productName,
    defaults.productId,
    defaults.priceId
  ].map((value) => value?.trim()).filter(Boolean).join(" / ");
}

export function resourceCreateDefaultsContextItems(defaults: ResourceCreateDefaults): Sub2RepairContextItem[] {
  const resource = [
    defaults.resourceType,
    defaults.resourceStatus,
    defaults.resourceScope
  ].filter(Boolean).join(" / ");
  const smoke = [
    resourceCreateDefaultsSmokeModel(defaults) ? `model ${resourceCreateDefaultsSmokeModel(defaults)}` : undefined,
    healthFlag("responses", defaults.responsesOk),
    healthFlag("local", defaults.localProxyOk)
  ].filter(Boolean).join(" / ");
  const failure = [
    defaults.proxyRequestPath,
    defaults.proxyRequestStatusCode ? `HTTP ${defaults.proxyRequestStatusCode}` : undefined,
    defaults.proxyRequestErrorCode,
    defaults.smokeTestSkippedReason ? `skip ${defaults.smokeTestSkippedReason}` : undefined,
    defaults.ageMinutes ? `${defaults.ageMinutes} 分钟前` : undefined,
    defaults.staleThresholdMinutes ? `阈值 ${defaults.staleThresholdMinutes} 分钟` : undefined,
    defaults.freshMinutesRemaining && defaults.stale !== "true" ? `剩余 ${defaults.freshMinutesRemaining} 分钟过期` : undefined,
    defaults.staleAt ? `staleAt ${defaults.staleAt}` : undefined,
    defaults.stale === "true" ? "证据已过期" : undefined
  ].filter(Boolean).join(" / ");
  const product = resourceCreateDefaultsProductText(defaults);
  const sub2Account = defaults.sub2AccountId
    ? `#${defaults.sub2AccountId}${defaults.sub2AccountName ? ` / ${defaults.sub2AccountName}` : ""}`
    : defaults.sub2AccountName;
  const accountDiagnostics = [
    defaults.schedulable ? `schedulable ${defaults.schedulable}` : undefined,
    defaults.tempUnschedulableReason ? `temp ${defaults.tempUnschedulableReason}` : undefined,
    defaults.accountUpdatedAt ? `updated ${defaults.accountUpdatedAt}` : undefined,
    defaults.accountMessage ? defaults.accountMessage.slice(0, 240) : undefined
  ].filter(Boolean).join(" / ");

  return [
    { label: "Source", value: [defaults.checkId, defaults.resourceScope].filter(Boolean).join(" / ") },
    { label: "Repair action", value: defaults.repairAction },
    { label: "Product", value: product },
    { label: "Supplier", value: defaults.supplierEmail },
    { label: "Resource", value: resource },
    { label: "Sub2 account", value: sub2Account },
    { label: "Account status", value: [defaults.accountStatus, defaults.credentialsStatus].filter(Boolean).join(" / ") },
    { label: "Account diagnostics", value: accountDiagnostics },
    { label: "Credential apply", value: resourceCreateDefaultsShouldApplyCredential(defaults) ? "enabled after create" : undefined },
    { label: "Smoke", value: resourceCreateDefaultsShouldRunSmokeTest(defaults) ? smoke || "enabled after apply" : undefined },
    { label: "Failure", value: failure }
  ].filter((item): item is Sub2RepairContextItem => Boolean(item.value));
}

function healthFlag(label: string, value?: string) {
  if (!value) return undefined;
  if (value === "true") return `${label} 通过`;
  if (value === "false") return `${label} 失败`;
  return `${label} ${value}`;
}
