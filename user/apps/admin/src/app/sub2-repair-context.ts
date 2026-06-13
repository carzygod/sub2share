export interface Sub2RepairContext {
  accountId?: string | null;
  sub2AccountName?: string;
  accountStatus?: string;
  credentialsStatus?: string;
  schedulable?: string;
  accountMessage?: string;
  accountErrorStatusCode?: string;
  accountErrorType?: string;
  accountErrorCode?: string;
  accountErrorMessage?: string;
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
  rentalId?: string | null;
  sub2UserId?: string | null;
  sub2KeyId?: string | null;
  endpointUrl?: string | null;
  requestId?: string;
  proxyRequestLogId?: string;
  upstreamRequestId?: string;
  proxyRequestPath?: string;
  proxyRequestStatusCode?: string;
  proxyRequestErrorCode?: string;
  model?: string;
  modelsOk?: string;
  modelsStatusCode?: string;
  modelsError?: string;
  responsesOk?: string;
  responsesStatusCode?: string;
  responsesErrorType?: string;
  responsesErrorMessage?: string;
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
  accountErrorStatusCode?: string;
  accountErrorType?: string;
  accountErrorCode?: string;
  accountErrorMessage?: string;
  accountUpdatedAt?: string;
  model?: string;
  modelsOk?: string;
  responsesOk?: string;
  responsesStatusCode?: string;
  responsesErrorType?: string;
  responsesErrorMessage?: string;
  modelsStatusCode?: string;
  modelsError?: string;
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

export interface ResourceRepairActionCandidate {
  checkId?: unknown;
  resourceList?: unknown;
  supplierEmail?: unknown;
  resourceType?: unknown;
  resourceStatus?: unknown;
  resourceScope?: unknown;
  sub2AccountId?: unknown;
}

export interface ResourceCredentialApplyCandidate {
  resourceType?: string | null;
  sub2AccountId?: string | null;
  credential?: {
    credentialType?: string | null;
    status?: string | null;
  } | null;
  credentialApplyLogs?: Array<{
    after?: unknown;
  }> | null;
}

export interface ProxyRequestFilterCandidate {
  proxyRequestFilterLookup?: unknown;
  proxyRequestFilterStatus?: unknown;
}

export interface ProxyRequestFilterTarget {
  kind: "lookup" | "status";
  value: string;
}

export interface ProxyRequestRepairCandidate {
  id?: unknown;
  requestId?: unknown;
  upstreamRequestId?: unknown;
  path?: unknown;
  model?: unknown;
  statusCode?: unknown;
  upstreamStatusCode?: unknown;
  errorCode?: unknown;
  rentalId?: unknown;
  resourceType?: unknown;
  sub2UserId?: unknown;
  sub2KeyId?: unknown;
  endpointUrl?: unknown;
  supplierResourceId?: unknown;
  supplierResource?: ProxyRequestSupplierResourceCandidate | null;
  rental?: {
    id?: unknown;
    supplierResourceId?: unknown;
    resourceType?: unknown;
    sub2UserId?: unknown;
    sub2KeyId?: unknown;
    endpointUrl?: unknown;
    supplierResource?: ProxyRequestSupplierResourceCandidate | null;
  } | null;
}

export interface ProxyRequestSupplierResourceCandidate {
  id?: unknown;
  resourceType?: unknown;
  status?: unknown;
  sub2AccountId?: unknown;
  supplier?: {
    user?: {
      email?: unknown;
    } | null;
  } | null;
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
  const hasRentalDelivery = Boolean(context.rentalId || context.endpointUrl);
  const rentalDelivery = hasRentalDelivery
    ? [context.rentalId, context.resourceType, context.endpointUrl].filter(Boolean).join(" / ")
    : "";
  const sub2Delivery = [
    context.sub2UserId ? `user ${context.sub2UserId}` : undefined,
    context.sub2KeyId ? `key ${context.sub2KeyId}` : undefined
  ].filter(Boolean).join(" / ");
  const request = [context.requestId, context.proxyRequestLogId, context.upstreamRequestId]
    .filter(Boolean)
    .join(" / ");
  const smoke = [
    context.model ? `model ${context.model}` : undefined,
    healthFlag("models", context.modelsOk),
    smokePhaseSummary("models", context.modelsStatusCode, undefined, context.modelsError),
    healthFlag("responses", context.responsesOk),
    smokePhaseSummary("responses", context.responsesStatusCode, context.responsesErrorType, context.responsesErrorMessage),
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
    accountErrorSummary(context),
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
    { label: "租赁通道", value: rentalDelivery },
    { label: "Sub2 Key", value: sub2Delivery },
    { label: "供给方", value: context.supplierEmail },
    { label: "请求定位", value: request },
    { label: "Smoke", value: smoke },
    { label: "失败请求", value: failingRequest }
  ].filter((item): item is Sub2RepairContextItem => Boolean(item.value));
}

export function sub2RepairContextShouldRunSmokeTest(context: Sub2RepairContext) {
  return context.checkId === "localProxySmoke"
    || context.modelsOk === "false"
    || context.responsesOk === "false"
    || context.localProxyOk === "false"
    || Boolean(context.proxyRequestPath || context.proxyRequestStatusCode || context.proxyRequestErrorCode);
}

export function sub2RepairContextSmokeModel(context: Sub2RepairContext) {
  return context.model?.trim() || "";
}

export function sub2RepairContextShouldSaveToResource(context: Sub2RepairContext) {
  const resourceType = repairCandidateText(context.resourceType);
  if (resourceType && resourceType !== "codex") return false;

  if (repairCandidateText(context.resourceId)) return true;
  if (!repairCandidateText(context.supplierEmail)) return false;

  const repairAction = repairCandidateText(context.repairAction);
  if (repairAction === "apply_openai_refresh_token_to_sub2_account") return true;

  return ["resources", "resourceCredentials", "productCatalog", "salesDelivery", "localProxySmoke", "sub2", "proxyRequests"].includes(repairCandidateText(context.checkId));
}

export function resourceCreateDefaultsShouldApplyCredential(defaults: ResourceCreateDefaults) {
  return defaults.repairAction === "apply_openai_refresh_token_to_sub2_account" && Boolean(defaults.sub2AccountId?.trim());
}

export function resourceCreateDefaultsShouldRunSmokeTest(defaults: ResourceCreateDefaults) {
  if (!resourceCreateDefaultsShouldApplyCredential(defaults)) return false;
  return defaults.resourceType === "codex"
    || defaults.checkId === "resources"
    || defaults.resourceScope === "production"
    || defaults.modelsOk === "false"
    || defaults.responsesOk === "false"
    || defaults.localProxyOk === "false"
    || Boolean(defaults.proxyRequestPath || defaults.proxyRequestStatusCode || defaults.proxyRequestErrorCode);
}

export function resourceCreateDefaultsSmokeModel(defaults: ResourceCreateDefaults) {
  return defaults.model?.trim() || "";
}

export function resourceCredentialApplyShouldRunSmokeTest(resource: ResourceCredentialApplyCandidate) {
  return resource.resourceType === "codex"
    && Boolean(resource.sub2AccountId?.trim())
    && resource.credential?.credentialType === "openai_refresh_token"
    && resource.credential.status === "active";
}

export function resourceCredentialApplySmokeModel(resource: ResourceCredentialApplyCandidate) {
  for (const log of resource.credentialApplyLogs ?? []) {
    const after = plainRecord(log.after);
    const directModel = repairCandidateText(after?.model);
    if (directModel) return directModel;

    const smokeTest = plainRecord(after?.smokeTest);
    const smokeModel = repairCandidateText(smokeTest?.model);
    if (smokeModel) return smokeModel;
  }
  return "";
}

export function resourceRepairCandidateHasResourceFilter(candidate: ResourceRepairActionCandidate) {
  return boolish(candidate.resourceList)
    || Boolean(
      repairCandidateText(candidate.supplierEmail)
      || repairCandidateText(candidate.resourceType)
      || repairCandidateText(candidate.resourceStatus)
      || repairCandidateText(candidate.resourceScope)
      || repairCandidateText(candidate.sub2AccountId)
    );
}

export function resourceRepairActionShouldOpenResources(candidate: ResourceRepairActionCandidate) {
  return ["productCatalog", "salesDelivery"].includes(repairCandidateText(candidate.checkId)) && resourceRepairCandidateHasResourceFilter(candidate);
}

export function proxyRequestFilterTarget(candidate: ProxyRequestFilterCandidate): ProxyRequestFilterTarget | null {
  const lookup = repairCandidateText(candidate.proxyRequestFilterLookup);
  if (lookup) return { kind: "lookup", value: lookup };

  const status = repairCandidateText(candidate.proxyRequestFilterStatus);
  return status ? { kind: "status", value: status } : null;
}

export function proxyRequestShouldOpenSub2Repair(candidate: ProxyRequestRepairCandidate) {
  const errorCode = repairCandidateText(candidate.errorCode);
  const statusCode = repairCandidateNumber(candidate.statusCode);
  const upstreamStatusCode = repairCandidateNumber(candidate.upstreamStatusCode);

  return Boolean(
    (upstreamStatusCode !== null && upstreamStatusCode >= 400)
    || (statusCode !== null && statusCode >= 500)
    || errorCode.startsWith("upstream_")
    || ["upstream_timeout", "upstream_unavailable", "upstream_stream_error", "upstream_stream_closed", "upstream_stream_idle_timeout"].includes(errorCode)
  );
}

export function proxyRequestRepairContext(candidate: ProxyRequestRepairCandidate): Sub2RepairContext | null {
  if (!proxyRequestShouldOpenSub2Repair(candidate)) return null;

  const statusCode = repairCandidateScalarText(candidate.statusCode);
  const upstreamStatusCode = repairCandidateScalarText(candidate.upstreamStatusCode);
  const proxyRequestStatusCode = upstreamStatusCode || statusCode;
  const proxyRequestPath = repairCandidateText(candidate.path);
  const rental = candidate.rental ?? {};
  const supplierResource: ProxyRequestSupplierResourceCandidate = candidate.supplierResource ?? rental.supplierResource ?? {};
  const accountId = repairCandidateText(supplierResource.sub2AccountId);
  const resourceId = repairCandidateText(candidate.supplierResourceId) || repairCandidateText(rental.supplierResourceId) || repairCandidateText(supplierResource.id);
  const resourceStatus = repairCandidateText(supplierResource.status);
  const supplierEmail = repairCandidateText(supplierResource.supplier?.user?.email);
  return {
    checkId: "proxyRequests",
    checkLabel: "反代请求日志",
    repairAction: "apply_openai_refresh_token_to_sub2_account",
    actionHint: "Review Sub2/OpenAI upstream status, apply a fresh credential if needed, then rerun the proxy smoke test.",
    ...(accountId ? { accountId } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(resourceStatus ? { resourceStatus } : {}),
    ...(supplierEmail ? { supplierEmail } : {}),
    rentalId: repairCandidateText(candidate.rentalId) || repairCandidateText(rental.id) || undefined,
    resourceType: repairCandidateText(candidate.resourceType) || repairCandidateText(rental.resourceType) || repairCandidateText(supplierResource.resourceType) || undefined,
    sub2UserId: repairCandidateText(candidate.sub2UserId) || repairCandidateText(rental.sub2UserId) || undefined,
    sub2KeyId: repairCandidateText(candidate.sub2KeyId) || repairCandidateText(rental.sub2KeyId) || undefined,
    endpointUrl: repairCandidateText(candidate.endpointUrl) || repairCandidateText(rental.endpointUrl) || undefined,
    requestId: repairCandidateText(candidate.requestId) || undefined,
    proxyRequestLogId: repairCandidateText(candidate.id) || undefined,
    upstreamRequestId: repairCandidateText(candidate.upstreamRequestId) || undefined,
    proxyRequestPath: proxyRequestPath || undefined,
    proxyRequestStatusCode: proxyRequestStatusCode || undefined,
    proxyRequestErrorCode: repairCandidateText(candidate.errorCode) || undefined,
    model: repairCandidateText(candidate.model) || undefined,
    responsesOk: proxyRequestPath.includes("/v1/responses") ? "false" : undefined,
    localProxyOk: "false"
  };
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
    healthFlag("models", defaults.modelsOk),
    smokePhaseSummary("models", defaults.modelsStatusCode, undefined, defaults.modelsError),
    healthFlag("responses", defaults.responsesOk),
    smokePhaseSummary("responses", defaults.responsesStatusCode, defaults.responsesErrorType, defaults.responsesErrorMessage),
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
    accountErrorSummary(defaults),
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

function smokePhaseSummary(label: string, statusCode?: string, errorType?: string, errorMessage?: string) {
  return [
    statusCode ? `${label} HTTP ${statusCode}` : undefined,
    errorType,
    errorMessage
  ].filter(Boolean).join(" / ");
}

function accountErrorSummary(source: {
  accountErrorStatusCode?: string;
  accountErrorType?: string;
  accountErrorCode?: string;
  accountErrorMessage?: string;
}) {
  return [
    source.accountErrorStatusCode ? `HTTP ${source.accountErrorStatusCode}` : undefined,
    source.accountErrorCode,
    source.accountErrorType,
    source.accountErrorMessage
  ].filter(Boolean).join(" / ");
}

function repairCandidateText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function repairCandidateScalarText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return repairCandidateText(value);
}

function boolish(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function repairCandidateNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}
