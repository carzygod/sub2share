export interface Sub2RepairContext {
  accountId?: string | null;
  sub2AccountName?: string;
  accountStatus?: string;
  credentialsStatus?: string;
  checkId?: string;
  checkLabel?: string;
  repairAction?: string;
  resourceId?: string;
  resourceType?: string;
  resourceStatus?: string;
  resourceScope?: string;
  supplierEmail?: string;
  requestId?: string;
  proxyRequestLogId?: string;
  upstreamRequestId?: string;
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
  return [
    { label: "来源", value: [context.checkLabel, context.checkId].filter(Boolean).join(" / ") },
    { label: "维修动作", value: context.repairAction },
    { label: "目标账号", value: account },
    { label: "账号状态", value: [context.accountStatus, context.credentialsStatus].filter(Boolean).join(" / ") },
    { label: "资源", value: resource },
    { label: "供给方", value: context.supplierEmail },
    { label: "请求定位", value: request }
  ].filter((item): item is Sub2RepairContextItem => Boolean(item.value));
}
